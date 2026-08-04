import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  buildBaseline,
  compareBenchmarkToBaseline,
  validateBenchmarkSample,
} from "../../scripts/hve/worker-benchmark-baseline.mjs";

function keypair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function sample(index: number, overrides: Record<string, unknown> = {}) {
  const report = {
    schemaVersion: 1,
    kind: "hve-worker-benchmark",
    status: "PASS",
    benchmark: { threads: 4, durationSeconds: 60 },
    environment: {
      cpuModel: "Timeweb CPU 8",
      logicalCpu: 8,
      cgroupCpuLimitCores: 7.5,
      effectiveCpuCores: 7.5,
      effectiveMemoryBytes: 10 * 1024 ** 3,
      scratchTotalBytes: 100 * 1024 ** 3,
      scratchFreeBytesBefore: 80 * 1024 ** 3,
      scratchFreeBytesAfter: 79 * 1024 ** 3,
      kernel: "6.8.0",
      python: "3.12.12",
      ffmpeg: "ffmpeg version n8.0",
      ffmpegBuildSha256: "a".repeat(64),
      imageDigest: `sha256:${"b".repeat(64)}`,
    },
    result: {
      fixture: {
        sourceDurationSeconds: 60,
        sourceResolution: "1280x720",
        outputResolution: "1080x1920",
        fps: 30,
        encoder: "libx264/veryfast",
        audio: "aac/128k",
      },
      render: {
        subprocessWallSeconds: 42 + index,
        subprocessPeakRssBytes: 700_000_000 + index,
        realtimeFactor: Number(((42 + index) / 60).toFixed(4)),
      },
    },
    ...overrides,
  };
  return { report, rawBytes: Buffer.from(JSON.stringify(report)) };
}

test("worker benchmark baseline demands real-identical reports and independent approval", () => {
  const evaluator = keypair();
  const samples = [sample(0), sample(1), sample(2)];
  assert.deepEqual(validateBenchmarkSample(samples[0].report), []);

  const candidate = buildBaseline({
    baselineId: "timeweb-cpu8-12gb-v1",
    reports: samples,
    privateKey: evaluator.privateKey,
  });
  assert.equal(candidate.status, "candidate");
  assert.equal(
    compareBenchmarkToBaseline({ ...sample(1), baseline: candidate, publicKey: evaluator.publicKey }).status,
    "INSUFFICIENT",
  );

  const approved = buildBaseline({
    baselineId: "timeweb-cpu8-12gb-v1",
    reports: samples,
    privateKey: evaluator.privateKey,
    approval: { reference: "HVE-REVIEW-01", reviewedBy: "release-evaluator" },
  });
  const pass = compareBenchmarkToBaseline({ ...sample(1), baseline: approved, publicKey: evaluator.publicKey });
  assert.equal(pass.status, "PASS");
  assert.ok((pass.comparison?.rtfRatio ?? 2) <= 1);

  const regressed = sample(2, {
    result: {
      ...samples[2].report.result,
      render: { subprocessWallSeconds: 90, subprocessPeakRssBytes: 700_000_002, realtimeFactor: 1.5 },
    },
  });
  assert.equal(
    compareBenchmarkToBaseline({ ...regressed, baseline: approved, publicKey: evaluator.publicKey }).status,
    "FAIL",
  );

  const quotaChanged = sample(2, {
    environment: { ...samples[2].report.environment, cgroupCpuLimitCores: 6, effectiveCpuCores: 6 },
  });
  assert.equal(
    compareBenchmarkToBaseline({ ...quotaChanged, baseline: approved, publicKey: evaluator.publicKey }).status,
    "INSUFFICIENT",
  );
});
