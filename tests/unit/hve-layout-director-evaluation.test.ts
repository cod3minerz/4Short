import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, sha256, signCorpusIndex } from "../../scripts/hve/corpus-index.mjs";
import { evaluateLayoutDirector } from "../../scripts/hve/layout-director-evaluation.mjs";

const hash = (value: string) => sha256(value);

function fixture() {
  const specs: Array<[itemId: string, contentType: string]> = [
    ["screen-01", "screen_speaker"],
    ["game-01", "gameplay_facecam"],
    ["panel-01", "panel"],
  ];
  const items = specs.map(([itemId]) => ({
    itemId,
    objectKey: `corpus/${itemId}.mp4`, sha256: hash(`${itemId}-source`), objectBytes: 100,
    annotationKey: `annotations/${itemId}.json`, annotationSha256: hash(`${itemId}-annotation`),
    licenseRef: `licenses/${itemId}.txt`, licenseArtifactSha256: hash(`${itemId}-license`), durationUs: 4_000_000,
    tags: ["content/test", "faces/test", "geometry/test"], evaluationRanges: [{ startUs: 0, endUs: 4_000_000 }],
  }));
  const manifest = { schemaVersion: 1, corpusVersion: "layout-eval-v1", split: "development", status: "ready", createdAt: "2026-08-03T00:00:00.000Z", items };
  const index = {
    schemaVersion: 1, kind: "hve-corpus-object-index", corpusVersion: manifest.corpusVersion, manifestSha256: sha256(canonicalJson(manifest)), generatedAt: "2026-08-03T00:00:00.000Z", verifier: { id: "evaluator" },
    objects: Object.fromEntries(items.flatMap((item) => [[item.objectKey, { sha256: item.sha256, bytes: 100 }], [item.annotationKey, { sha256: item.annotationSha256, bytes: 100 }], [item.licenseRef, { sha256: item.licenseArtifactSha256, bytes: 100 }]])),
    signature: { algorithm: "ed25519", keyFingerprint: hash("fixture-key"), value: "fixture" },
  };
  const rangeFor = (itemId: string) => {
    if (itemId === "screen-01") return { contentType: "screen_speaker", template: "screen_speaker", roles: { "gold-screen": "screen", "gold-face": "face" } };
    if (itemId === "game-01") return { contentType: "gameplay_facecam", template: "gameplay_facecam", roles: { "gold-game": "gameplay", "gold-facecam": "facecam" } };
    return { contentType: "panel", template: "grid_3", roles: { "gold-face-1": "face", "gold-face-2": "face", "gold-face-3": "face" } };
  };
  const labels = {
    schemaVersion: 1, kind: "hve-layout-director-labels-v1", corpusVersion: manifest.corpusVersion, manifestSha256: index.manifestSha256, objectIndexSha256: sha256(canonicalJson(index)), evaluatorKeyFingerprint: index.signature.keyFingerprint,
    items: items.map((item) => {
      const range = rangeFor(item.itemId);
      return { itemId: item.itemId, annotationSha256: item.annotationSha256, annotation: {
        ranges: [{ rangeId: "range-1", startUs: 0, endUs: 4_000_000, contentType: range.contentType, preferredLayouts: [range.template], acceptableLayouts: [range.template], forbiddenLayouts: ["portrait_focus"], constraints: { mustKeepRegionIds: Object.keys(range.roles), safeZoneIds: [], regionRoles: range.roles } }],
      } };
    }),
  };
  const predictions = {
    schemaVersion: 1, kind: "hve-layout-director-predictions-v1", corpusVersion: manifest.corpusVersion, manifestSha256: index.manifestSha256, objectIndexSha256: sha256(canonicalJson(index)), evaluatorKeyFingerprint: index.signature.keyFingerprint,
    candidate: { regionDetector: "candidate-region", regionModelVersion: "v1", regionModelSha256: hash("region"), faceDetector: "yunet", faceModelVersion: "v1", faceModelSha256: hash("face"), directorVersion: "hve-director-v1", directorCodeSha256: hash("director") },
    hardware: { profile: "timeweb-cpu8-12gb", cpuCount: 8, memoryBytes: 12 * 1024 ** 3 },
    items: items.map((item) => {
      const range = rangeFor(item.itemId);
      const ids = Object.keys(range.roles);
      return {
        itemId: item.itemId, sourceHash: item.sha256,
        evaluatorMappings: { regions: Object.fromEntries(ids.map((id, index) => [`candidate-${index + 1}`, id])) },
        decisions: [{ rangeId: "range-1", range: { startUs: 0, endUs: 4_000_000 }, template: range.template, transitionLatencyMs: 240, regions: ids.map((_, index) => ({ regionId: `candidate-${index + 1}`, visibleAreaRatio: 1 })) }],
        measurement: { peakRssBytes: 4 * 1024 ** 3, sustainedSwapBytes: 0, wallSeconds: 5, mediaSeconds: 4, coldStartSeconds: 1 },
      };
    }),
  };
  return { manifest, index, labels, predictions };
}

test("HVE-G6 evaluator derives role recall, layout accuracy and preservation from labelled semantic regions", () => {
  const report = evaluateLayoutDirector({ manifest: fixture().manifest, objectIndex: fixture().index, labels: fixture().labels, predictions: fixture().predictions });
  const screen = report.strata.screen_presenter as { screenRegionRecall: number; faceRegionRecall: number };
  const panel = report.strata.panel_three_four as { panelTrackRecall: number };
  assert.equal(screen.screenRegionRecall, 1);
  assert.equal(screen.faceRegionRecall, 1);
  assert.equal(report.strata.gameplay_facecam.layoutAccuracy, 1);
  assert.equal(panel.panelTrackRecall, 1);
  assert.equal(report.safety.forbiddenLayoutRate, 0);
  assert.equal(report.safety.importantScreenCropLossRate, 0);
});

test("HVE-G6 evaluator records forbidden layouts and insufficient important-region visibility", () => {
  const input = fixture();
  input.predictions.items[0]!.decisions[0]!.template = "portrait_focus";
  input.predictions.items[0]!.decisions[0]!.regions[0]!.visibleAreaRatio = 0.5;
  const report = evaluateLayoutDirector({ manifest: input.manifest, objectIndex: input.index, labels: input.labels, predictions: input.predictions });
  assert.ok(report.safety.forbiddenLayoutRate > 0);
  assert.ok(report.safety.importantScreenCropLossRate > 0);
  assert.equal(report.evaluation.failureSamples[0]!.reason, "forbidden_layout");
});

test("HVE-G6 evaluator CLI accepts only evaluator-signed labels/predictions and writes a provenance-bound report", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hve-g6-evaluator-"));
  try {
    const input = fixture();
    const keypair = generateKeyPairSync("ed25519");
    const privateKey = keypair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = keypair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const manifestPath = path.join(directory, "manifest.json"); const indexPath = path.join(directory, "index.json"); const publicPath = path.join(directory, "public.pem"); const labelsPath = path.join(directory, "labels.json"); const predictionsPath = path.join(directory, "predictions.json"); const reportPath = path.join(directory, "report.json");
    await writeFile(manifestPath, JSON.stringify(input.manifest));
    const manifestSha = sha256(await readFile(manifestPath));
    const { signature: ignored, ...unsignedIndex } = input.index; void ignored;
    const index = signCorpusIndex({ ...unsignedIndex, manifestSha256: manifestSha }, privateKey);
    for (const bundle of [input.labels, input.predictions]) { bundle.manifestSha256 = manifestSha; bundle.objectIndexSha256 = sha256(canonicalJson(index)); bundle.evaluatorKeyFingerprint = index.signature.keyFingerprint; }
    await Promise.all([writeFile(indexPath, JSON.stringify(index)), writeFile(publicPath, publicKey), writeFile(labelsPath, JSON.stringify(signCorpusIndex(input.labels, privateKey))), writeFile(predictionsPath, JSON.stringify(signCorpusIndex(input.predictions, privateKey)))]);
    const privatePath = path.join(directory, "private.pem");
    await writeFile(privatePath, privateKey, { mode: 0o600 });
    const run = spawnSync(process.execPath, ["scripts/hve/evaluate-layout-director-benchmark.mjs", `--manifest=${manifestPath}`, `--object-index=${indexPath}`, `--public-key=${publicPath}`, `--private-key=${privatePath}`, `--labels=${labelsPath}`, `--predictions=${predictionsPath}`, `--out=${reportPath}`], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.evaluation.evaluatorVersion, "hve-layout-director-evaluator-v1");
    const promotion = spawnSync(process.execPath, ["scripts/hve/validate-layout-director-benchmark.mjs", `--report=${reportPath}`, `--public-key=${publicPath}`], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(promotion.status, 2, `${promotion.stdout}${promotion.stderr}`);
    assert.match(`${promotion.stdout}${promotion.stderr}`, /strata\.screen_presenter\.samples/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("HVE-G6 smoke never scores signed bundles when the corpus-integrity boundary fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hve-g6-smoke-route-"));
  try {
    const input = fixture();
    const keypair = generateKeyPairSync("ed25519");
    const privateKey = keypair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = keypair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const manifestPath = path.join(directory, "manifest.json");
    const indexPath = path.join(directory, "index.json");
    const publicPath = path.join(directory, "public.pem");
    const privatePath = path.join(directory, "private.pem");
    const labelsPath = path.join(directory, "labels.json");
    const predictionsPath = path.join(directory, "predictions.json");
    const outputDirectory = path.join(directory, "smoke");
    await writeFile(manifestPath, JSON.stringify(input.manifest));
    const manifestSha = sha256(await readFile(manifestPath));
    const { signature: ignored, ...unsignedIndex } = input.index; void ignored;
    const index = signCorpusIndex({ ...unsignedIndex, manifestSha256: manifestSha }, privateKey);
    for (const bundle of [input.labels, input.predictions]) {
      bundle.manifestSha256 = manifestSha;
      bundle.objectIndexSha256 = sha256(canonicalJson(index));
      bundle.evaluatorKeyFingerprint = index.signature.keyFingerprint;
    }
    await Promise.all([
      writeFile(indexPath, JSON.stringify(index)),
      writeFile(publicPath, publicKey),
      writeFile(privatePath, privateKey, { mode: 0o600 }),
      writeFile(labelsPath, JSON.stringify(signCorpusIndex(input.labels, privateKey))),
      writeFile(predictionsPath, JSON.stringify(signCorpusIndex(input.predictions, privateKey))),
    ]);
    const run = spawnSync(process.execPath, ["scripts/hve/run-hve6-smoke.mjs", `--output-dir=${outputDirectory}`], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HVE_G6_CORPUS_MANIFEST: manifestPath,
        HVE_CORPUS_OBJECT_INDEX: indexPath,
        HVE_CORPUS_INDEX_PUBLIC_KEY_FILE: publicPath,
        HVE_G6_EVALUATOR_PRIVATE_KEY_FILE: privatePath,
        HVE_G6_LAYOUT_LABELS: labelsPath,
        HVE_G6_LAYOUT_PREDICTIONS: predictionsPath,
      },
    });
    // The compact fixture deliberately has only three items and lacks the
    // evaluator's full ready-corpus verification facts. The smoke route must
    // reject it before it asks the evaluator to derive/sign any benchmark.
    assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
    const metrics = JSON.parse(await readFile(path.join(outputDirectory, "metrics.json"), "utf8"));
    const suites = new Map(metrics.suites.map((suite: { name: string; status: string }) => [suite.name, suite.status]));
    assert.equal(suites.get("layout_director_corpus_integrity"), "FAIL");
    assert.equal(suites.get("layout_director_evaluation"), "INSUFFICIENT");
    assert.equal(suites.get("layout_director_benchmark"), "INSUFFICIENT");
    await assert.rejects(readFile(path.join(outputDirectory, "layout-director-benchmark.signed.json"), "utf8"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
