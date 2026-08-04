import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { sha256, signCorpusIndex } from "../../scripts/hve/corpus-index.mjs";

function keypair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const suiteNames = [
  "contracts", "time_map", "speech", "active_speaker", "crop_tracking", "layout", "captions", "render", "editor_parity", "queue_fairness", "worker_benchmark", "chaos",
  "holdout", "stress", "market",
];
const strata = [
  "solo", "conversation", "panel_3", "panel_4_plus", "remote_grid", "screen_speaker", "screen_only", "gameplay_facecam", "gameplay_only", "vertical_source", "broll_voiceover", "no_speech", "vfr", "hevc_mov",
];

function thresholds(status: "active" | "scaffold") {
  return {
    schemaVersion: 1,
    name: "production-test-v1",
    gate: {
      status,
      requiredSplits: ["smoke", "development", "holdout", "stress"],
      requiredReports: ["metrics.json", "corpus-summary.json", "junit.xml", "report.html", "failed-items.json", "baseline-comparison.json", "environment.json"],
      requiredSuites: suiteNames,
      requiredStrata: strata,
      minimumCorpus: { sourceCount: 180, annotatedRangeCount: 1_500, durationHours: 75, russianRatio: 0.7, minimumPerRequiredStratum: 20 },
      hardwareBaseline: "timeweb-cpu8-12gb-v1",
    },
    sceneF1At500msMin: 0.94,
    contentMacroF1Min: 0.9,
    activeSpeakerTwoPersonF1Min: 0.92,
    activeSpeakerHardF1Min: 0.85,
    speakerVisibleRatioMin: 0.98,
    acceptableLayoutRatioMin: 0.92,
    forbiddenLayoutCountMax: 0,
    cropOutOfBoundsCountMax: 0,
    previewGeometryErrorPxMax: 2,
    avSyncP95MsMax: 80,
    peakWorkerRssBytesMax: 9_663_676_416,
    renderP95RtfMax: 2,
    weightedJainFairnessMin: 0.95,
    starvationCountMax: 0,
    marketPreferredRatioMin: 0.6,
    marketWilsonLowerBoundMin: 0.5,
    marketLosingMajorStratumCountMax: 0,
    manualCorrectionRateMax: 0.1,
  };
}

async function writeReleaseEvidence(directory: string, privateKey: string, options: { omitSuite?: string; mismatchedEnvironment?: boolean; mismatchedCorpusSummary?: boolean } = {}) {
  const artifacts: Record<string, string> = {};
  const aggregateMetrics = {
    sceneF1At500ms: 0.95,
    contentMacroF1: 0.91,
    activeSpeakerTwoPersonF1: 0.93,
    activeSpeakerHardF1: 0.86,
    speakerVisibleRatio: 0.99,
    acceptableLayoutRatio: 0.94,
    forbiddenLayoutCount: 0,
    cropOutOfBoundsCount: 0,
    previewGeometryErrorPx: 1,
    avSyncP95Ms: 50,
    peakWorkerRssBytes: 7_000_000_000,
    renderP95Rtf: 1.2,
    weightedJainFairness: 0.97,
    starvationCount: 0,
    marketPreferredRatio: 0.65,
    marketWilsonLowerBound: 0.51,
    marketLosingMajorStratumCount: 0,
    manualCorrectionRate: 0.08,
  };
  const corpus = {
    splits: Object.fromEntries(["smoke", "development", "holdout", "stress"].map((split) => [split, {
      sourceCount: 45,
      annotatedRangeCount: 400,
      manifestSha256: sha256(`manifest-${split}`),
      ...(split === "holdout" ? { sealed: true } : {}),
    }])),
    sourceCount: 180,
    annotatedRangeCount: 1_600,
    durationHours: 80,
    russianRatio: 0.75,
    strata: Object.fromEntries(strata.map((stratum) => [stratum, { status: "PASS", sourceCount: 20 }])),
  };
  const payloads: Record<string, string> = {
    "metrics.json": JSON.stringify({ status: "PASS", suites: suiteNames.filter((name) => name !== options.omitSuite).map((name) => ({ name, status: "PASS" })), aggregateMetrics }),
    "corpus-summary.json": JSON.stringify(options.mismatchedCorpusSummary ? { ...corpus, sourceCount: 181 } : corpus),
    "junit.xml": "<testsuite failures=\"0\"/>",
    "report.html": "<!doctype html><title>sealed evidence</title>",
    "failed-items.json": "[]",
    "baseline-comparison.json": JSON.stringify({ status: "PASS", baselineId: "timeweb-cpu8-12gb-v1" }),
    "environment.json": JSON.stringify({
      gitSha: options.mismatchedEnvironment ? "c".repeat(40) : "b".repeat(40),
      imageDigest: `sha256:${"a".repeat(64)}`,
      ffmpegBuildSha256: "d".repeat(64),
      modelHashes: { yunet: "e".repeat(64) },
    }),
  };
  for (const [name, content] of Object.entries(payloads)) {
    const bytes = Buffer.from(content);
    artifacts[name] = sha256(bytes);
    await writeFile(path.join(directory, name), bytes);
  }
  const evidence = signCorpusIndex({
    schemaVersion: 1,
    kind: "hve-production-evidence",
    thresholdVersion: "production-test-v1",
    candidate: { gitSha: "b".repeat(40), imageDigest: `sha256:${"a".repeat(64)}` },
    corpus,
    metrics: aggregateMetrics,
    baseline: { baselineId: "timeweb-cpu8-12gb-v1", comparisonStatus: "PASS" },
    artifacts,
    signedAt: "2026-08-03T00:00:00.000Z",
  }, privateKey);
  await writeFile(path.join(directory, "release-evidence.json"), JSON.stringify(evidence));
}

test("sealed release verifier binds all required artifacts, corpus and frozen thresholds", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hve-release-gate-"));
  try {
    const evaluator = keypair();
    const thresholdPath = path.join(directory, "thresholds.json");
    const publicKeyPath = path.join(directory, "evaluator-public.pem");
    await writeFile(thresholdPath, JSON.stringify(thresholds("active")));
    await writeFile(publicKeyPath, evaluator.publicKey);
    await writeReleaseEvidence(directory, evaluator.privateKey);
    const run = () => spawnSync(process.execPath, [
      "scripts/hve/validate-production-release.mjs",
      `--evidence-dir=${directory}`,
      `--thresholds=${thresholdPath}`,
      `--public-key=${publicKeyPath}`,
    ], { cwd: process.cwd(), encoding: "utf8" });
    const assemble = (allowScaffold = false) => spawnSync(process.execPath, [
      "scripts/hve/assemble-production-release-evidence.mjs",
      `--evidence-dir=${directory}`,
      `--thresholds=${thresholdPath}`,
      `--candidate-git-sha=${"b".repeat(40)}`,
      `--candidate-image-digest=sha256:${"a".repeat(64)}`,
      "--overwrite",
      ...(allowScaffold ? ["--allow-scaffold"] : []),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HVE_RELEASE_EVALUATOR_PRIVATE_KEY_FILE: path.join(directory, "evaluator-private.pem") },
    });
    await writeFile(path.join(directory, "evaluator-private.pem"), evaluator.privateKey, { mode: 0o600 });

    assert.equal(assemble().status, 0);
    assert.equal(run().status, 0);
    await writeFile(path.join(directory, "report.html"), "tampered");
    const tampered = run();
    assert.equal(tampered.status, 1);
    assert.match(`${tampered.stdout}${tampered.stderr}`, /artifact hash mismatch: report\.html/i);

    await writeReleaseEvidence(directory, evaluator.privateKey, { omitSuite: "market" });
    const insufficient = run();
    assert.equal(insufficient.status, 2);
    assert.match(`${insufficient.stdout}${insufficient.stderr}`, /required suite market is missing/i);

    await writeReleaseEvidence(directory, evaluator.privateKey, { mismatchedEnvironment: true });
    const mismatched = run();
    assert.equal(mismatched.status, 1);
    assert.match(`${mismatched.stdout}${mismatched.stderr}`, /does not bind the evaluated report/i);

    await writeReleaseEvidence(directory, evaluator.privateKey, { mismatchedCorpusSummary: true });
    const mismatchedCorpus = run();
    assert.equal(mismatchedCorpus.status, 1);
    assert.match(`${mismatchedCorpus.stdout}${mismatchedCorpus.stderr}`, /corpus-summary\.json does not match/i);

    await writeFile(thresholdPath, JSON.stringify(thresholds("scaffold")));
    assert.equal(assemble().status, 2);
    assert.equal(assemble(true).status, 0);
    const scaffold = run();
    assert.equal(scaffold.status, 2);
    assert.match(`${scaffold.stdout}${scaffold.stderr}`, /thresholds are scaffolded/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
