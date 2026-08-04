import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runWorkerUnittest, workerTestRuntimeDescription } from "./worker-unittest.mjs";

/**
 * Local/CI smoke evidence for the HVE-2 time-map executor.
 *
 * This is deliberately not a release gate. It proves that the checked-in
 * deterministic fixtures execute through a real FFmpeg binary and emits
 * inspectable evidence. Corpus coverage, visual goldens and a Timeweb
 * hardware benchmark remain mandatory before HVE-G2 can become active.
 */
const outputArgument = process.argv.find((argument) => argument.startsWith("--output-dir="));
const outputDirectory = path.resolve(
  outputArgument?.slice("--output-dir=".length)
    ?? path.join("outputs", "hve", "hve-g2-smoke", new Date().toISOString().replaceAll(":", "-")),
);

await mkdir(outputDirectory, { recursive: true });

function command(name, command, args, options = {}) {
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`;
  return {
    name,
    command: [command, ...args].join(" "),
    status: result.status === 0 && !result.error ? "PASS" : "FAIL",
    wallSeconds: Number(((performance.now() - startedAt) / 1_000).toFixed(3)),
    output,
  };
}

function classifyEvidenceStatus(suite) {
  // A developer machine may deliberately not contain the worker image's
  // Python dependencies or libass. That means this gate has no evidence — it
  // is not a renderer regression. CI installs the worker and treats a real
  // assertion failure as FAIL.
  if (/ModuleNotFoundError: No module named '(?:pydantic_settings|cv2|numpy|boto3|faster_whisper)'/i.test(suite.output)
    || /FACE_RUNTIME_MISSING|VISION_RUNTIME_MISSING|libass|No such filter: ['"]?ass/i.test(suite.output)) {
    suite.status = "INSUFFICIENT";
    return;
  }
  // Node's test summary always contains a `skipped 0` line. Only a positive
  // skipped count (or unittest's explicit skipped list) invalidates renderer
  // evidence.
  if (/skipped(?:=|\s+)(?!0\b)\d+/i.test(suite.output)) suite.status = "INSUFFICIENT";
}

const nodeBinary = process.execPath;
const runTimingSuite = (name, testFile) => command(
  name,
  nodeBinary,
  ["./node_modules/tsx/dist/cli.mjs", "--test", testFile],
);
const runRenderEvidence = (name, testPattern) => runWorkerUnittest(name, { file: "test_render.py", pattern: testPattern });
const suites = [
  runTimingSuite("time_map_and_captions", "tests/unit/hve-time-map.test.ts"),
  runTimingSuite("resolved_execution_plan", "tests/unit/hve-render-plan.test.ts"),
  // These are intentionally individual FFmpeg assertions. Running the full
  // file twice under invented labels made the old report look stronger than
  // its evidence actually was.
  // Keep the evidence-suite name aligned with the release-gate grammar:
  // this assertion decodes the resulting MP4, verifies its audio stream and
  // checks source-cut timing rather than only inspecting a generated filter.
  runRenderEvidence("audio_source_cut_full_decode", "source_cut_executes_as_full_decode"),
  runRenderEvidence("microsecond_time_map", "hve2_time_map_executes_at_microsecond_boundaries"),
  runRenderEvidence("timed_caption_burn_in", "hve2_output_timed_captions_are_burned_after_source_cuts"),
  runRenderEvidence("caption_preset_burn_in", "hve2_public_and_legacy_caption_presets_produce_visible_burned_output"),
];

// A skipped integration test is not evidence for a renderer slice. Treat it
// as insufficient even if unittest itself returns zero.
for (const suite of suites) classifyEvidenceStatus(suite);

const status = suites.some((suite) => suite.status === "FAIL")
  ? "FAIL"
  : suites.some((suite) => suite.status === "INSUFFICIENT")
    ? "INSUFFICIENT"
    : "PASS";
const failedItems = suites
  .filter((suite) => suite.status !== "PASS")
  .map((suite) => ({ suite: suite.command, status: suite.status, output: suite.output.slice(-8_000) }));
const gitSha = command("git_sha", "git", ["rev-parse", "HEAD"]);
const environment = {
  os: `${os.type()} ${os.release()}`,
  arch: process.arch,
  node: process.version,
  workerTestRuntime: workerTestRuntimeDescription(),
  ffmpeg: command("ffmpeg", "ffmpeg", ["-version"]),
  ffprobe: command("ffprobe", "ffprobe", ["-version"]),
  gitSha: gitSha.status === "PASS" ? gitSha.output.trim() : null,
  generatedAt: new Date().toISOString(),
  scope: "HVE-G2 synthetic FFmpeg smoke only; not a production, corpus, or performance approval.",
};
const metrics = {
  schemaVersion: 1,
  status,
  runId: `hve-g2-smoke-${Date.now()}`,
  createdAt: new Date().toISOString(),
  candidate: {
    gitSha: environment.gitSha,
    renderer: "fourshort_worker.render.render_clip",
    planner: "@4short/contracts hve-time-map",
  },
  environment,
  suites: suites.map((suite) => ({
    name: suite.name,
    command: suite.command,
    status: suite.status,
    wallSeconds: suite.wallSeconds,
  })),
  requiredEvidenceStillMissing: [
    "private ready corpus with real object and annotation hashes",
    "representative caption visual goldens and safe-zone collision corpus",
    "Timeweb CPU8/12GB benchmark with peak RSS, scratch and realtime-factor thresholds",
  ],
};
const cdata = (value) => value.replaceAll("]]>", "]]]]><![CDATA[>");
const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="hve-g2-smoke" tests="${suites.length}" failures="${failedItems.length}">${suites.map((suite) => `<testcase name="${suite.command.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")}" time="${suite.wallSeconds}">${suite.status === "PASS" ? "" : `<failure message="${suite.status}"><![CDATA[${cdata(suite.output)}]]></failure>`}</testcase>`).join("")}</testsuite>\n`;
const report = `<!doctype html><html lang="en"><meta charset="utf-8"><title>HVE-G2 smoke</title><body><h1>HVE-G2 synthetic FFmpeg smoke: ${status}</h1><p>This report is evidence of a checked-in synthetic media test only. It is not a production release approval.</p><pre>${JSON.stringify(metrics, null, 2).replaceAll("<", "&lt;")}</pre></body></html>\n`;

await Promise.all([
  writeFile(path.join(outputDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "environment.json"), `${JSON.stringify(environment, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "failed-items.json"), `${JSON.stringify(failedItems, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "junit.xml"), junit),
  writeFile(path.join(outputDirectory, "report.html"), report),
]);

console.log(`HVE-G2 smoke ${status}: ${outputDirectory}`);
process.exit(status === "PASS" ? 0 : status === "INSUFFICIENT" ? 2 : 1);
