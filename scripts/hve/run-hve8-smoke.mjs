import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runWorkerUnittest, workerTestRuntimeDescription } from "./worker-unittest.mjs";

/**
 * HVE-G8's first executable evidence is intentionally narrower than a public
 * B-roll launch. It proves the deterministic, user-supplied visual-replace
 * primitive and its media validation boundary. Costed generation, music and
 * public editor controls remain deliberately insufficient/locked.
 */
const argument = process.argv.find((value) => value.startsWith("--output-dir="));
const outputDirectory = path.resolve(argument?.slice("--output-dir=".length)
  ?? path.join("outputs", "hve", "hve-g8-smoke", new Date().toISOString().replaceAll(":", "-")));
await mkdir(outputDirectory, { recursive: true });

function run(name, executable, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options,
  });
  return {
    name,
    command: [executable, ...args].join(" "),
    status: result.status === 0 && !result.error ? "PASS" : "FAIL",
    wallSeconds: Number(((performance.now() - started) / 1_000).toFixed(3)),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`,
  };
}

function classify(suite) {
  if (/ModuleNotFoundError: No module named '(?:pydantic_settings|cv2|numpy|boto3|httpx)'/i.test(suite.output)
    || /skipped(?:=|\s+)(?!0\b)\d+/i.test(suite.output)) suite.status = "INSUFFICIENT";
}

const runPython = (name, file, pattern) => runWorkerUnittest(name, { file, pattern });
const suites = [
  run("layer_policy", process.execPath, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-render-plan.test.ts"]),
  run("media_validation", process.execPath, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-timed-brand-assets.test.ts"]),
  runPython("timed_asset_verification", "test_proxy.py", "timed_brand_video"),
  runPython("broll_render", "test_render.py", "broll_replaces_only_visuals_and_preserves_narrative_audio"),
];
for (const suite of suites) classify(suite);

// The primitive may pass its executable tests while the G8 product gate stays
// insufficient: it has no costed generation provider, no music mix policy and
// no public editor control. This exit code prevents accidental promotion.
const executableStatus = suites.some((suite) => suite.status === "FAIL") ? "FAIL"
  : suites.some((suite) => suite.status === "INSUFFICIENT") ? "INSUFFICIENT" : "PASS";
const status = executableStatus === "FAIL" ? "FAIL" : "INSUFFICIENT";
const missing = [
  "cost-idempotency ledger for generative operations",
  "music mix / loudness policy",
  "public editor B-roll control and preview parity",
  "licensed visual corpus and approval baseline",
];
const failedItems = suites.filter((suite) => suite.status !== "PASS")
  .map((suite) => ({ suite: suite.name, status: suite.status, output: suite.output.slice(-8_000) }));
if (status === "INSUFFICIENT") failedItems.push({ suite: "HVE-G8 release gate", status: "INSUFFICIENT", output: missing.join("; ") });
const environment = {
  os: `${os.type()} ${os.release()}`, arch: process.arch, node: process.version,
  ffmpeg: run("ffmpeg", "ffmpeg", ["-version"]), workerTestRuntime: workerTestRuntimeDescription(),
  generatedAt: new Date().toISOString(),
  scope: "HVE-G8 internal B-roll executor only; not a public production release.",
};
const metrics = {
  schemaVersion: 1, status, executableStatus, runId: `hve-g8-smoke-${Date.now()}`, createdAt: new Date().toISOString(),
  candidate: { planner: "@4short/contracts resolved B-roll policy", renderer: "fourshort_worker.render slot compositor" },
  environment, suites: suites.map(({ name, command, status: suiteStatus, wallSeconds }) => ({ name, command, status: suiteStatus, wallSeconds })),
  requiredEvidenceStillMissing: missing,
};
const cdata = (value) => value.replaceAll("]]>", "]]]]><![CDATA[>");
const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="hve-g8-smoke" tests="${suites.length}" failures="${failedItems.length}">${suites.map((suite) => `<testcase name="${suite.name}" time="${suite.wallSeconds}">${suite.status === "PASS" ? "" : `<failure message="${suite.status}"><![CDATA[${cdata(suite.output)}]]></failure>`}</testcase>`).join("")}</testsuite>\n`;
const report = `<!doctype html><html lang="en"><meta charset="utf-8"><title>HVE-G8 smoke</title><body><h1>HVE-G8 smoke: ${status}</h1><p>Internal B-roll evidence; not a production approval.</p><pre>${JSON.stringify(metrics, null, 2).replaceAll("<", "&lt;")}</pre></body></html>\n`;
await Promise.all([
  writeFile(path.join(outputDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "environment.json"), `${JSON.stringify(environment, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "failed-items.json"), `${JSON.stringify(failedItems, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "junit.xml"), junit),
  writeFile(path.join(outputDirectory, "report.html"), report),
]);
console.log(`HVE-G8 smoke ${status}: ${outputDirectory}`);
process.exit(status === "FAIL" ? 1 : 2);
