import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalJson,
  sha256,
  signCorpusIndex,
  validateAnnotationForItem,
  verifyCorpusIndex,
} from "../../scripts/hve/corpus-index.mjs";

function evaluatorKeypair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

test("the release-evaluator corpus signature covers canonical object facts", () => {
  const keypair = evaluatorKeypair();
  const unsigned = {
    schemaVersion: 1,
    kind: "hve-corpus-object-index",
    corpusVersion: "development-v1",
    manifestSha256: "a".repeat(64),
    generatedAt: "2026-08-03T00:00:00.000Z",
    verifier: { id: "release-evaluator" },
    objects: {
      "fixtures/a.mp4": { bytes: 123, sha256: "b".repeat(64), contentType: "video/mp4" },
    },
  };
  const index = signCorpusIndex(unsigned, keypair.privateKey);

  assert.equal(canonicalJson({ b: 2, a: [true, null] }), '{"a":[true,null],"b":2}');
  assert.equal(verifyCorpusIndex(index, keypair.publicKey), true);
  assert.equal(index.signature.keyFingerprint.length, 64);

  index.objects["fixtures/a.mp4"].bytes = 124;
  assert.equal(verifyCorpusIndex(index, keypair.publicKey), false);
});

test("annotation ground truth is bound to its source item and evaluation ranges", () => {
  const item = {
    itemId: "licensed-fixture-01",
    licenseRef: "licenses/development-v1/licensed-fixture-01.txt",
    durationUs: 3_000_000,
    evaluationRanges: [
      { startUs: 0, endUs: 1_000_000 },
      { startUs: 1_000_000, endUs: 2_000_000 },
      { startUs: 2_000_000, endUs: 3_000_000 },
    ],
  };
  const annotation = {
    schemaVersion: 1,
    itemId: item.itemId,
    timebase: "microseconds",
    licenseRef: item.licenseRef,
    annotation: { annotators: ["annotator-a", "annotator-b"], adjudicator: "reviewer-a", sealed: true },
    ranges: item.evaluationRanges.map((range, index) => ({
      rangeId: `range-${index + 1}`,
      ...range,
      contentType: "solo-talking",
      preferredLayouts: ["portrait_focus"],
      acceptableLayouts: ["portrait_focus"],
      forbiddenLayouts: [],
      constraints: { mustKeepRegionIds: [], safeZoneIds: [], activeSpeakerRegionId: null },
    })),
  };

  assert.deepEqual(validateAnnotationForItem(annotation, item), []);
  assert.match(
    validateAnnotationForItem({ ...annotation, itemId: "another-item", ranges: annotation.ranges.slice(0, 2) }, item).join("\n"),
    /itemId does not match|not covered by annotation ground truth/,
  );
  assert.match(
    validateAnnotationForItem({ ...annotation, ranges: [{ ...annotation.ranges[0], preferredLayouts: undefined }] }, item).join("\n"),
    /preferredLayouts is malformed/,
  );

  assert.deepEqual(validateAnnotationForItem({
    ...annotation,
    activeSpeaker: {
      schemaVersion: 1,
      stratum: "clean_two_person",
      turns: [
        { turnId: "turn-1", startUs: 0, endUs: 1_000_000, speakerId: "speaker-a", faceRegionId: "presenter-a" },
        { turnId: "turn-2", startUs: 1_000_000, endUs: 2_000_000, speakerId: "speaker-b", faceRegionId: "presenter-b" },
        { turnId: "turn-3", startUs: 2_000_000, endUs: 3_000_000, speakerId: "speaker-a", faceRegionId: null },
      ],
    },
  }, item), []);
  assert.match(
    validateAnnotationForItem({
      ...annotation,
      activeSpeaker: {
        schemaVersion: 1,
        stratum: "clean_two_person",
        turns: [
          { turnId: "turn-1", startUs: 0, endUs: 2_000_000, speakerId: "speaker-a", faceRegionId: "presenter-a" },
          { turnId: "turn-2", startUs: 1_000_000, endUs: 3_000_000, speakerId: "speaker-b", faceRegionId: "presenter-b" },
        ],
      },
    }, item).join("\n"),
    /activeSpeaker\.turns must be sorted and non-overlapping/,
  );
});

test("ready corpus validation refuses a changed signed object index", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hve-corpus-index-"));
  try {
    const keypair = evaluatorKeypair();
    const items = Array.from({ length: 24 }, (_, index) => {
      const itemId = `licensed-fixture-${String(index + 1).padStart(2, "0")}`;
      const objectKey = `fixtures/development-v1/${itemId}.mp4`;
      const annotationKey = `annotations/development-v1/${itemId}.json`;
      const licenseRef = `licenses/development-v1/${itemId}.txt`;
      return {
        itemId,
        objectKey,
        sha256: sha256(`media:${itemId}`),
        objectBytes: 1_000 + index,
        annotationKey,
        annotationSha256: sha256(`annotation:${itemId}`),
        licenseRef,
        licenseArtifactSha256: sha256(`license:${itemId}`),
        durationUs: 3_000_000,
        tags: ["content/solo", "faces/one", "codec/h264", "geometry/cfr", "speech/ru"],
        evaluationRanges: [
          { startUs: 0, endUs: 1_000_000 },
          { startUs: 1_000_000, endUs: 2_000_000 },
          { startUs: 2_000_000, endUs: 3_000_000 },
        ],
      };
    });
    const manifest = {
      schemaVersion: 1,
      corpusVersion: "development-v1",
      split: "smoke",
      status: "ready",
      createdAt: "2026-08-03T00:00:00.000Z",
      items,
    };
    const manifestPath = path.join(directory, "manifest.json");
    const publicKeyPath = path.join(directory, "evaluator-public.pem");
    const indexPath = path.join(directory, "object-index.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(publicKeyPath, keypair.publicKey);

    const objects: Record<string, { sha256: string; bytes: number }> = {};
    for (const item of items) {
      objects[item.objectKey] = { sha256: item.sha256, bytes: item.objectBytes };
      objects[item.annotationKey] = { sha256: item.annotationSha256, bytes: 123 };
      objects[item.licenseRef] = { sha256: item.licenseArtifactSha256, bytes: 456 };
    }
    const manifestBytes = await (await import("node:fs/promises")).readFile(manifestPath);
    const index = signCorpusIndex({
      schemaVersion: 1,
      kind: "hve-corpus-object-index",
      corpusVersion: manifest.corpusVersion,
      manifestSha256: sha256(manifestBytes),
      generatedAt: "2026-08-03T00:00:00.000Z",
      verifier: { id: "release-evaluator" },
      verification: { annotationSchema: "hve-annotation-v1", annotationsVerified: true },
      objects,
    }, keypair.privateKey);
    await writeFile(indexPath, JSON.stringify(index));

    const run = () => spawnSync(process.execPath, [
      "scripts/hve/validate-corpus.mjs",
      manifestPath,
      `--object-index=${indexPath}`,
      `--public-key=${publicKeyPath}`,
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run().status, 0);

    index.objects[items[0]!.objectKey].bytes += 1;
    await writeFile(indexPath, JSON.stringify(index));
    const tampered = run();
    assert.equal(tampered.status, 1);
    assert.match(`${tampered.stdout}${tampered.stderr}`, /signature is absent, invalid, or does not cover/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corpus validation rejects unsorted ranges, reused annotations and schema drift before trusting signed facts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hve-corpus-contract-"));
  try {
    const baseItem = (index: number) => ({
      itemId: `fixture-${String(index).padStart(2, "0")}`,
      objectKey: `fixtures/development-v2/fixture-${String(index).padStart(2, "0")}.mp4`,
      sha256: sha256(`media-${index}`),
      objectBytes: 1_000 + index,
      annotationKey: `annotations/development-v2/fixture-${String(index).padStart(2, "0")}.json`,
      annotationSha256: sha256(`annotation-${index}`),
      licenseRef: `licenses/development-v2/fixture-${String(index).padStart(2, "0")}.txt`,
      licenseArtifactSha256: sha256(`license-${index}`),
      durationUs: 3_000_000,
      tags: ["content/solo", "faces/one", "codec/h264", "geometry/cfr", "speech/ru"],
      evaluationRanges: [
        { startUs: 0, endUs: 1_000_000 },
        { startUs: 1_000_000, endUs: 2_000_000 },
        { startUs: 2_000_000, endUs: 3_000_000 },
      ],
    });
    const manifest = {
      schemaVersion: 1,
      corpusVersion: "development-v2",
      split: "smoke",
      status: "ready",
      createdAt: "2026-08-03T00:00:00.000Z",
      items: Array.from({ length: 24 }, (_, index) => baseItem(index + 1)),
    };
    const manifestPath = path.join(directory, "manifest.json");
    const run = () => spawnSync(process.execPath, ["scripts/hve/validate-corpus.mjs", manifestPath], {
      cwd: process.cwd(), encoding: "utf8",
    });

    manifest.items[0]!.evaluationRanges.reverse();
    await writeFile(manifestPath, JSON.stringify(manifest));
    let result = run();
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /evaluationRanges\[1\].*sorted and non-overlapping/i);

    manifest.items[0]!.evaluationRanges.reverse();
    manifest.items[1]!.annotationKey = manifest.items[0]!.annotationKey;
    await writeFile(manifestPath, JSON.stringify(manifest));
    result = run();
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /annotationKey.*must not be reused/i);

    manifest.items[1]!.annotationKey = baseItem(2).annotationKey;
    (manifest as Record<string, unknown>).unexpected = "not signed schema";
    await writeFile(manifestPath, JSON.stringify(manifest));
    result = run();
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /unknown top-level fields/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corpus validation fails closed for non-object manifests instead of crashing the evaluator", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hve-corpus-malformed-"));
  try {
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(manifestPath, "null\n");
    const result = spawnSync(process.execPath, ["scripts/hve/validate-corpus.mjs", manifestPath], {
      cwd: process.cwd(), encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /manifest: must be an object/i);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /TypeError/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a scaffold corpus can only pass explicit manifest lint and never corpus verification", () => {
  const manifestPath = "verification/hve/manifests/smoke-v1.json";
  const strict = spawnSync(process.execPath, ["scripts/hve/validate-corpus.mjs", manifestPath], {
    cwd: process.cwd(), encoding: "utf8",
  });
  assert.equal(strict.status, 2);
  assert.match(`${strict.stdout}${strict.stderr}`, /not ready|placeholder hash|no verified expected object size/i);

  const lint = spawnSync(process.execPath, ["scripts/hve/validate-corpus.mjs", manifestPath, "--manifest-lint"], {
    cwd: process.cwd(), encoding: "utf8",
  });
  assert.equal(lint.status, 0);
  assert.match(`${lint.stdout}${lint.stderr}`, /HVE MANIFEST LINT ONLY/i);
  assert.match(`${lint.stdout}${lint.stderr}`, /not corpus integrity/i);
  assert.match(`${lint.stdout}${lint.stderr}`, /release approval/i);

  const deprecatedBypass = spawnSync(process.execPath, ["scripts/hve/validate-corpus.mjs", manifestPath, "--allow-scaffold"], {
    cwd: process.cwd(), encoding: "utf8",
  });
  assert.equal(deprecatedBypass.status, 1);
  assert.match(`${deprecatedBypass.stdout}${deprecatedBypass.stderr}`, /no longer accepted/i);
});
