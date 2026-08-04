import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runWorkerModule, runWorkerUnittest, workerTestRuntimeDescription } from "./worker-unittest.mjs";

/**
 * HVE-G7 executable evidence, deliberately narrower than the production
 * gate.  It exercises the exact PostgreSQL queue claim path when a test
 * database is provided and a real FFmpeg benchmark harness when the worker
 * dependencies are installed.  It never promotes a short CI sample into a
 * Timeweb hardware baseline: that requires three signed 60-second runs from
 * an immutable worker image and independent approval.
 */
const outputArgument = process.argv.find((argument) => argument.startsWith("--output-dir="));
const outputDirectory = path.resolve(
  outputArgument?.slice("--output-dir=".length)
    ?? path.join("outputs", "hve", "hve-g7-smoke", new Date().toISOString().replaceAll(":", "-")),
);
await mkdir(outputDirectory, { recursive: true });

function run(name, executable, args, options = {}) {
  const startedAt = performance.now();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options,
  });
  return {
    name,
    command: [executable, ...args].join(" "),
    status: result.status === 0 && !result.error ? "PASS" : "FAIL",
    wallSeconds: Number(((performance.now() - startedAt) / 1_000).toFixed(3)),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`,
  };
}

function markInsufficient(suite, pattern, reason) {
  if (suite.status === "FAIL" && pattern.test(suite.output)) {
    suite.status = "INSUFFICIENT";
    suite.insufficientReason = reason;
  }
}

function classifyIntegration(suite) {
  if (/\bSKIP\b|tests 0[\s\S]*skipped [1-9]/i.test(suite.output)) {
    suite.status = "INSUFFICIENT";
    suite.insufficientReason = "HVE_TEST_DATABASE_URL and HVE_ALLOW_DESTRUCTIVE_INTEGRATION_TESTS=1 are required for isolated PostgreSQL claim-path evidence";
  }
}

const node = process.execPath;
const tsx = "./node_modules/tsx/dist/cli.mjs";
const benchmarkEvidenceDirectory = path.join(outputDirectory, "worker-benchmark");
const benchmarkOutput = path.join(benchmarkEvidenceDirectory, "worker-benchmark.json");
const benchmarkScratch = path.join(outputDirectory, "benchmark-scratch");
// The isolated container keeps the production worker UID.  Make only the
// synthetic benchmark mounts writable for that UID; the directory contains no
// customer media or secrets and is created inside ignored local/CI evidence.
await Promise.all([
  mkdir(benchmarkEvidenceDirectory, { recursive: true, mode: 0o777 }),
  mkdir(benchmarkScratch, { recursive: true, mode: 0o777 }),
]);
await Promise.all([
  chmod(benchmarkEvidenceDirectory, 0o777),
  chmod(benchmarkScratch, 0o777),
]);
const workerTest = (name, file) => runWorkerUnittest(name, { file });
const workerBenchmark = () => {
  const image = process.env.HVE_WORKER_TEST_IMAGE?.trim();
  return runWorkerModule("worker_benchmark", {
    args: [
      "-m", "fourshort_worker.benchmark",
      "--duration-seconds=1",
      "--allow-short",
      image ? "--scratch-root=/scratch" : `--scratch-root=${benchmarkScratch}`,
      image ? "--output=/evidence/worker-benchmark.json" : `--output=${benchmarkOutput}`,
    ],
    mounts: image
      ? [
          { host: benchmarkEvidenceDirectory, container: "/evidence" },
          { host: benchmarkScratch, container: "/scratch" },
        ]
      : [],
  });
};
const suites = [
  run("queue_concurrency", node, [tsx, "--test", "tests/integration/queue-pg.test.ts"], { env: process.env }),
  run("queue_fairness", node, [tsx, "--test", "tests/integration/queue-pg.test.ts"], { env: process.env }),
  run("queue_offered_load", node, [tsx, "--test", "tests/integration/queue-load-pg.test.ts"], { env: process.env }),
  run("lease_recovery_chaos", node, [tsx, "--test", "tests/integration/queue-pg.test.ts"], { env: process.env }),
  // The PostgreSQL lease test proves state recovery after a worker disappears.
  // This companion proof covers the other half of that guarantee: a worker
  // which detects a lost lease terminates the full FFmpeg process group rather
  // than leaving a decoder/encoder descendant to consume the heavy slot.
  workerTest("lease_cancellation_process_tree", "test_process.py"),
  workerTest("resource_admission", "test_resources.py"),
  // Control-plane selection is tested independently from the Python worker so
  // a local developer machine without media dependencies can still prove the
  // fail-closed ETA policy. Production evidence still requires the complete
  // worker registration suite below.
  run("eta_runtime_scope", node, [tsx, "--test", "tests/unit/hve-runtime-identity.test.ts"], { env: process.env }),
  // Runtime identity is part of the ETA safety contract: timings from a
  // previous image/model/cgroup must not calibrate a newly deployed worker.
  workerTest("worker_runtime_identity", "test_worker_heartbeat.py"),
  // These are deterministic, isolated fault injections: a lost process tree,
  // memory/scratch admission and provider timeout must each become a bounded
  // recoverable state. They are smoke evidence only; the target-worker S3 and
  // restart cases remain release-runbook evidence and cannot be faked in CI.
  workerTest("chaos", [
    "test_process.py",
    "test_resources.py",
    "test_provider_failures.py",
    "test_storage_failures.py",
  ]),
  workerBenchmark(),
];
for (const suite of suites.slice(0, 4)) classifyIntegration(suite);
for (const suite of suites) {
  markInsufficient(
    suite,
    /ModuleNotFoundError: No module named '(?:pydantic_settings|psutil|httpx|boto3)'|No module named fourshort_worker/i,
    "the installed media-worker Python environment is required for the benchmark",
  );
}

let benchmark = null;
try {
  benchmark = JSON.parse(await readFile(benchmarkOutput, "utf8"));
  if (benchmark?.status !== "PASS") {
    const suite = suites.find((item) => item.name === "worker_benchmark");
    if (suite) suite.status = "FAIL";
  }
} catch {
  // The suite's command status and captured output are the authoritative
  // failure record when report generation itself did not complete.
}

const status = suites.some((suite) => suite.status === "FAIL") ? "FAIL"
  : suites.some((suite) => suite.status === "INSUFFICIENT") ? "INSUFFICIENT" : "PASS";
const failedItems = suites.filter((suite) => suite.status !== "PASS")
  .map((suite) => ({
    suite: suite.name,
    status: suite.status,
    reason: suite.insufficientReason,
    output: suite.output.slice(-8_000),
  }));
const baselineComparison = {
  status: "INSUFFICIENT",
  scope: "A one-second CI sample proves benchmark execution only. It cannot be compared to or replace the approved Timeweb CPU8/12GB baseline.",
  requiredForApproval: [
    "three 60-second reports from the same immutable OCI image",
    "matching FFmpeg build and worker image digest",
    "Ed25519-signed baseline with independent approval reference",
  ],
};
const environment = {
  os: `${os.type()} ${os.release()}`,
  arch: process.arch,
  node: process.version,
  workerTestRuntime: workerTestRuntimeDescription(),
  isolatedTestDatabaseConfigured: Boolean(
    process.env.HVE_TEST_DATABASE_URL
      && process.env.HVE_ALLOW_DESTRUCTIVE_INTEGRATION_TESTS === "1",
  ),
  benchmarkEnvironment: benchmark?.environment ?? null,
  generatedAt: new Date().toISOString(),
  scope: "HVE-G7 executable queue/benchmark smoke only; not a queue-load, hardware-baseline or production release approval.",
};
const metrics = {
  schemaVersion: 1,
  status,
  runId: `hve-g7-smoke-${Date.now()}`,
  createdAt: new Date().toISOString(),
  candidate: {
    scheduler: "services/control-api/src/services/queue.ts persistent weighted fair dispatch",
    workerBenchmark: "fourshort_worker.benchmark synthetic FFmpeg fixture",
  },
  environment,
  suites: suites.map(({ name, command, status: suiteStatus, wallSeconds }) => ({ name, command, status: suiteStatus, wallSeconds })),
  requiredEvidenceStillMissing: [
    "target-worker 30-workspace offered-load observation with real service times and ETA coverage",
    "target-worker worker kill/restart, S3/provider timeout and scratch-pressure chaos evidence",
    "approved signed Timeweb CPU8/12GB 60-second benchmark baseline",
    "ETA coverage observations from production-equivalent completed jobs",
  ],
};
const cdata = (value) => value.split("]]>").join("]]" + "]]><![CDATA[>");
const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="hve-g7-smoke" tests="${suites.length}" failures="${failedItems.length}">${suites.map((suite) => `<testcase name="${suite.name}" time="${suite.wallSeconds}">${suite.status === "PASS" ? "" : `<failure message="${suite.status}"><![CDATA[${cdata(suite.output)}]]></failure>`}</testcase>`).join("")}</testsuite>\n`;
const report = `<!doctype html><html lang="en"><meta charset="utf-8"><title>HVE-G7 smoke</title><body><h1>HVE-G7 executable smoke: ${status}</h1><p>This is not a production approval. The baseline comparison intentionally remains INSUFFICIENT until evaluator-owned Timeweb evidence exists.</p><pre>${JSON.stringify({ metrics, baselineComparison }, null, 2).replaceAll("<", "&lt;")}</pre></body></html>\n`;
await Promise.all([
  writeFile(path.join(outputDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "environment.json"), `${JSON.stringify(environment, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "failed-items.json"), `${JSON.stringify(failedItems, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "baseline-comparison.json"), `${JSON.stringify(baselineComparison, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "junit.xml"), junit),
  writeFile(path.join(outputDirectory, "report.html"), report),
]);
console.log(`HVE-G7 smoke ${status}: ${outputDirectory}`);
process.exit(status === "PASS" ? 0 : status === "INSUFFICIENT" ? 2 : 1);
