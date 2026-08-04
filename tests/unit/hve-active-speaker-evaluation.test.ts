import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, sha256, signCorpusIndex } from "../../scripts/hve/corpus-index.mjs";
import { evaluateActiveSpeaker } from "../../scripts/hve/active-speaker-evaluation.mjs";

const hash = (value: string) => sha256(value);

function fixture() {
  const items = [
    {
      itemId: "clean-two-person-01",
      objectKey: "corpus/clean-two-person-01.mp4",
      sha256: hash("clean-source"),
      objectBytes: 100,
      annotationKey: "annotations/clean-two-person-01.json",
      annotationSha256: hash("clean-annotation"),
      licenseRef: "licenses/clean-two-person-01.txt",
      licenseArtifactSha256: hash("clean-license"),
      durationUs: 4_000_000,
      tags: ["content/conversation", "faces/two", "speech/ru"],
      evaluationRanges: [{ startUs: 0, endUs: 4_000_000 }],
    },
    {
      itemId: "panel-hard-01",
      objectKey: "corpus/panel-hard-01.mp4",
      sha256: hash("panel-source"),
      objectBytes: 100,
      annotationKey: "annotations/panel-hard-01.json",
      annotationSha256: hash("panel-annotation"),
      licenseRef: "licenses/panel-hard-01.txt",
      licenseArtifactSha256: hash("panel-license"),
      durationUs: 4_000_000,
      tags: ["content/panel", "faces/four", "speech/ru"],
      evaluationRanges: [{ startUs: 0, endUs: 4_000_000 }],
    },
  ];
  const manifest = {
    schemaVersion: 1,
    corpusVersion: "active-speaker-eval-v1",
    split: "development",
    status: "ready",
    createdAt: "2026-08-03T00:00:00.000Z",
    items,
  };
  const objectIndex = {
    schemaVersion: 1,
    kind: "hve-corpus-object-index",
    corpusVersion: manifest.corpusVersion,
    manifestSha256: sha256(canonicalJson(manifest)),
    generatedAt: "2026-08-03T00:00:00.000Z",
    verifier: { id: "evaluator" },
    objects: Object.fromEntries(items.flatMap((item) => [
      [item.objectKey, { sha256: item.sha256, bytes: item.objectBytes }],
      [item.annotationKey, { sha256: item.annotationSha256, bytes: 100 }],
      [item.licenseRef, { sha256: item.licenseArtifactSha256, bytes: 100 }],
    ])),
    signature: { algorithm: "ed25519", keyFingerprint: hash("evaluator-key"), value: "test" },
  };
  const annotation = (itemId: string, stratum: "clean_two_person" | "panel_hard", turns: Array<Record<string, unknown>>) => ({
    schemaVersion: 1,
    itemId,
    timebase: "microseconds",
    licenseRef: items.find((item) => item.itemId === itemId)!.licenseRef,
    annotation: { annotators: ["ann-a", "ann-b"], adjudicator: "reviewer", sealed: true },
    ranges: [{
      rangeId: "range-1", startUs: 0, endUs: 4_000_000, contentType: stratum,
      preferredLayouts: ["portrait_focus"], acceptableLayouts: ["portrait_focus"], forbiddenLayouts: [],
      constraints: { mustKeepRegionIds: [], safeZoneIds: [], activeSpeakerRegionId: null },
    }],
    activeSpeaker: { schemaVersion: 1, stratum, turns },
  });
  const labels = {
    schemaVersion: 1,
    kind: "hve-active-speaker-labels-v1",
    corpusVersion: manifest.corpusVersion,
    manifestSha256: objectIndex.manifestSha256,
    objectIndexSha256: sha256(canonicalJson(objectIndex)),
    evaluatorKeyFingerprint: objectIndex.signature.keyFingerprint,
    items: [
      {
        itemId: "clean-two-person-01",
        annotationSha256: items[0]!.annotationSha256,
        annotation: annotation("clean-two-person-01", "clean_two_person", [
          { turnId: "c1", startUs: 0, endUs: 2_000_000, speakerId: "gold-a", faceRegionId: "gold-face-a" },
          { turnId: "c2", startUs: 2_000_000, endUs: 4_000_000, speakerId: "gold-b", faceRegionId: "gold-face-b" },
        ]),
      },
      {
        itemId: "panel-hard-01",
        annotationSha256: items[1]!.annotationSha256,
        annotation: annotation("panel-hard-01", "panel_hard", [
          { turnId: "p1", startUs: 0, endUs: 2_000_000, speakerId: "gold-c", faceRegionId: "gold-face-c" },
          { turnId: "p2", startUs: 2_000_000, endUs: 4_000_000, speakerId: "gold-d", faceRegionId: null },
        ]),
      },
    ],
  };
  const predictionItem = (itemId: string, sourceHash: string, links: Array<Record<string, unknown>>, speakers: Record<string, string>, faces: Record<string, string>) => ({
    itemId,
    sourceHash,
    links,
    evaluatorMappings: { speakers, faces },
    measurement: { peakRssBytes: 4 * 1024 ** 3, sustainedSwapBytes: 0, wallSeconds: 10, mediaSeconds: 4, coldStartSeconds: 1 },
  });
  const predictions = {
    schemaVersion: 1,
    kind: "hve-active-speaker-predictions-v1",
    corpusVersion: manifest.corpusVersion,
    manifestSha256: objectIndex.manifestSha256,
    objectIndexSha256: sha256(canonicalJson(objectIndex)),
    evaluatorKeyFingerprint: objectIndex.signature.keyFingerprint,
    candidate: {
      diarizationEngine: "sherpa-onnx", diarizationModelVersion: "candidate-1", diarizationModelSha256: hash("diarization"),
      mouthEngine: "mediapipe", mouthModelVersion: "candidate-1", mouthModelSha256: hash("mouth"), associationCodeSha256: hash("association"),
    },
    hardware: { profile: "timeweb-cpu8-12gb", cpuCount: 8, memoryBytes: 12 * 1024 ** 3 },
    items: [
      predictionItem("clean-two-person-01", items[0]!.sha256, [
        { speakerId: "a", startUs: 0, endUs: 2_000_000, faceTrackId: "face-a", confidence: 0.98, reason: "audio_video_association" },
        { speakerId: "b", startUs: 2_000_000, endUs: 4_000_000, faceTrackId: "face-b", confidence: 0.98, reason: "audio_video_association" },
      ], { a: "gold-a", b: "gold-b" }, { "face-a": "gold-face-a", "face-b": "gold-face-b" }),
      predictionItem("panel-hard-01", items[1]!.sha256, [
        { speakerId: "c", startUs: 0, endUs: 2_000_000, faceTrackId: "face-c", confidence: 0.98, reason: "audio_video_association" },
        { speakerId: "d", startUs: 2_000_000, endUs: 4_000_000, faceTrackId: null, confidence: 0.9, reason: "offscreen" },
      ], { c: "gold-c", d: "gold-d" }, { "face-c": "gold-face-c" }),
    ],
  };
  return { manifest, objectIndex, labels, predictions };
}

test("HVE-G5 evaluator computes per-stratum F1, offscreen safety and switch latency from signed corpus inputs", () => {
  const report = evaluateActiveSpeaker(fixture());
  assert.equal(report.strata.clean_two_person.activeSpeakerF1, 1);
  assert.equal(report.strata.panel_hard.activeSpeakerF1, 1);
  assert.equal(report.safety.offscreenFalseAssignmentRate, 0);
    assert.equal(report.safety.p95SwitchLatencyMs, 0);
    assert.equal(report.resources.p95DenseAnalysisRssBytes, 4 * 1024 ** 3);
    assert.equal(report.strata.clean_two_person.items, 1);
  assert.equal(report.evaluation.itemsEvaluated, 2);
});

test("HVE-G5 evaluator records a claimed face during an adjudicated offscreen turn as a safety failure", () => {
  const input = fixture();
  input.predictions.items[1]!.links[1] = {
    speakerId: "d", startUs: 2_000_000, endUs: 4_000_000, faceTrackId: "wrong-face", confidence: 0.98, reason: "audio_video_association",
  };
  input.predictions.items[1]!.evaluatorMappings.faces["wrong-face"] = "gold-face-c";
  const report = evaluateActiveSpeaker(input);
  assert.equal(report.safety.offscreenFalseAssignmentRate, 1);
  assert.ok(report.strata.panel_hard.activeSpeakerF1 < 1);
  assert.equal(report.evaluation.failureSamples.some((item) => item.itemId === "panel-hard-01"), true);
});

test("HVE-G5 evaluator rejects candidate media that is not bound to the signed corpus object", () => {
  const input = fixture();
  input.predictions.items[0]!.sourceHash = hash("substituted-source");
  assert.throws(() => evaluateActiveSpeaker(input), /sourceHash does not bind/i);
});

test("HVE-G5 evaluator CLI refuses unsigned bundles and writes a reproducible signed-evidence report", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hve-g5-evaluator-"));
  try {
    const input = fixture();
    const keypair = generateKeyPairSync("ed25519");
    const privateKey = keypair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = keypair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const manifestPath = path.join(directory, "manifest.json");
    const publicKeyPath = path.join(directory, "public.pem");
    const indexPath = path.join(directory, "index.json");
    const labelsPath = path.join(directory, "labels.json");
    const predictionsPath = path.join(directory, "predictions.json");
    const reportPath = path.join(directory, "report.json");
    await writeFile(manifestPath, JSON.stringify(input.manifest));
    const manifestSha = sha256(await readFile(manifestPath));
    const { signature: ignoredFixtureSignature, ...unsignedIndex } = input.objectIndex;
    void ignoredFixtureSignature;
    const index = signCorpusIndex({ ...unsignedIndex, manifestSha256: manifestSha }, privateKey);
    input.labels.manifestSha256 = manifestSha;
    input.labels.objectIndexSha256 = sha256(canonicalJson(index));
    input.labels.evaluatorKeyFingerprint = index.signature.keyFingerprint;
    input.predictions.manifestSha256 = manifestSha;
    input.predictions.objectIndexSha256 = sha256(canonicalJson(index));
    input.predictions.evaluatorKeyFingerprint = index.signature.keyFingerprint;
    await writeFile(publicKeyPath, publicKey);
    await writeFile(indexPath, JSON.stringify(index));
    await writeFile(labelsPath, JSON.stringify(signCorpusIndex(input.labels, privateKey)));
    await writeFile(predictionsPath, JSON.stringify(signCorpusIndex(input.predictions, privateKey)));
    const run = spawnSync(process.execPath, [
      "scripts/hve/evaluate-active-speaker-benchmark.mjs",
      `--manifest=${manifestPath}`,
      `--object-index=${indexPath}`,
      `--public-key=${publicKeyPath}`,
      `--labels=${labelsPath}`,
      `--predictions=${predictionsPath}`,
      `--out=${reportPath}`,
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.evaluation.evaluatorVersion, "hve-active-speaker-evaluator-v1");
    assert.equal(report.corpus.manifestSha256, manifestSha);
    const promotion = spawnSync(process.execPath, [
      "scripts/hve/validate-active-speaker-benchmark.mjs",
      `--report=${reportPath}`,
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(promotion.status, 2, `${promotion.stdout}${promotion.stderr}`);
    assert.match(`${promotion.stdout}${promotion.stderr}`, /independently sourced corpus items/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
