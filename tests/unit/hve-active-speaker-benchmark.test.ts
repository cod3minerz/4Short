import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

function benchmarkReport() {
  return {
    schemaVersion: 1,
    kind: "hve-active-speaker-benchmark-v1",
    status: "pass",
    corpus: {
      version: "active-speaker-holdout-v1",
      signedObjectIndexSha256: "a".repeat(64),
      evaluatorKeyFingerprint: "b".repeat(64),
    },
    candidate: {
      diarizationEngine: "sherpa-onnx",
      diarizationModelVersion: "candidate-1",
      diarizationModelSha256: "c".repeat(64),
      mouthEngine: "mediapipe-face-landmarker",
      mouthModelVersion: "candidate-1",
      mouthModelSha256: "d".repeat(64),
      associationCodeSha256: "e".repeat(64),
    },
    hardware: { profile: "timeweb-cpu8-12gb", cpuCount: 8, memoryBytes: 12 * 1024 ** 3 },
    strata: {
      clean_two_person: { items: 24, samples: 120, activeSpeakerF1: 0.93, visibleSpeakerCoverage: 0.99 },
      panel_hard: { items: 24, samples: 120, activeSpeakerF1: 0.87, visibleSpeakerCoverage: 0.99 },
    },
    safety: { offscreenFalseAssignmentRate: 0.01, p95SwitchLatencyMs: 420, unresolvedSwitchRate: 0.01 },
    resources: { p95DenseAnalysisRssBytes: 8 * 1024 ** 3, sustainedSwapBytes: 0 },
    evaluation: {
      evaluatorVersion: "hve-active-speaker-evaluator-v1",
      itemsEvaluated: 200,
      turnsEvaluated: 3_000,
      predictionBundleSha256: "f".repeat(64),
      labelBundleSha256: "1".repeat(64),
      failureSamples: [],
    },
  };
}

test("active-speaker promotion verifier requires metric and hardware evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hve-g5-benchmark-"));
  try {
    const reportPath = path.join(directory, "report.json");
    const run = () => spawnSync(process.execPath, [
      "scripts/hve/validate-active-speaker-benchmark.mjs",
      `--report=${reportPath}`,
    ], { cwd: process.cwd(), encoding: "utf8" });

    await writeFile(reportPath, JSON.stringify(benchmarkReport()));
    assert.equal(run().status, 0);

    await writeFile(reportPath, JSON.stringify({
      ...benchmarkReport(),
      strata: {
        ...benchmarkReport().strata,
        panel_hard: { items: 24, samples: 120, activeSpeakerF1: 0.84, visibleSpeakerCoverage: 0.99 },
      },
    }));
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(`${failed.stdout}${failed.stderr}`, /panel_hard.*below 0\.85/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
