import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runWorkerUnittest, workerTestRuntimeDescription } from "./worker-unittest.mjs";

/**
 * Evidence for the deterministic compositor/package boundary. This runner
 * never promotes HVE-G3: it proves a real FFmpeg clip can be packaged and
 * decoded, while browser parity and corpus visual goldens remain mandatory.
 */
const argument = process.argv.find((value) => value.startsWith("--output-dir="));
const outputDirectory = path.resolve(argument?.slice("--output-dir=".length)
  ?? path.join("outputs", "hve", "hve-g3-smoke", new Date().toISOString().replaceAll(":", "-")));
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

const runRenderEvidence = (name, testPattern) => runWorkerUnittest(name, { file: "test_render.py", pattern: testPattern });
const suites = [
  run("slot_geometry", process.execPath, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-layout.test.ts"]),
  run("layers", process.execPath, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-render-plan.test.ts"]),
  // The TypeScript plan alone is not compositor evidence. These synthetic
  // fixtures decode the actual MP4 and inspect pixels at resolved geometry
  // and output-clock times. Each runs separately so a missing libass cannot
  // erase the evidence for source slots and static assets.
  runRenderEvidence("slot_compositor_render", "hve3_resolved_slot_compositor_executes_geometry_with_full_decode"),
  runRenderEvidence("contiguous_layout_segments_render", "hve3_contiguous_layout_segments_switch_on_the_shared_output_clock"),
  runRenderEvidence("dynamic_crop_render", "hve3_dynamic_crop_moves_across_verified_output_clock"),
  runRenderEvidence("static_asset_render", "hve3_verified_static_logo_is_burned_only_in_its_output_range"),
  runRenderEvidence("timed_video_overlay_render", "hve3_verified_timed_video_is_a_muted_overlay_at_its_output_range"),
  runRenderEvidence("timed_video_loop_render", "hve3_timed_video_loop_repeats_visual_input_without_extending_clip_clock"),
  runRenderEvidence("text_layer_render", "hve3_resolved_text_layer_is_burned_at_its_resolved_output_time"),
  runRenderEvidence("broll_visual_replace_render", "hve8_broll_replaces_only_visuals_and_preserves_narrative_audio"),
  runWorkerUnittest("project_package", { file: "test_project_package_media.py" }),
];
for (const suite of suites) classify(suite);
const status = suites.some((suite) => suite.status === "FAIL") ? "FAIL"
  : suites.some((suite) => suite.status === "INSUFFICIENT") ? "INSUFFICIENT" : "PASS";
const failedItems = suites.filter((suite) => suite.status !== "PASS")
  .map((suite) => ({ suite: suite.name, status: suite.status, output: suite.output.slice(-8_000) }));
const environment = {
  os: `${os.type()} ${os.release()}`, arch: process.arch, node: process.version,
  ffmpeg: run("ffmpeg", "ffmpeg", ["-version"]), workerTestRuntime: workerTestRuntimeDescription(),
  generatedAt: new Date().toISOString(),
  scope: "HVE-G3 synthetic package/decode smoke only; not browser parity or production approval.",
};
const metrics = {
  schemaVersion: 1, status, runId: `hve-g3-smoke-${Date.now()}`, createdAt: new Date().toISOString(),
  candidate: { renderer: "fourshort_worker.stages.zip_project", planner: "@4short/contracts hve-layout" },
  environment, suites: suites.map(({ name, command, status: suiteStatus, wallSeconds }) => ({ name, command, status: suiteStatus, wallSeconds })),
  requiredEvidenceStillMissing: ["browser/frame parity", "timed outro/audio layers", "licensed visual corpus and goldens", "Timeweb benchmark"],
};
const cdata = (value) => value.replaceAll("]]>", "]]]]><![CDATA[>");
const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="hve-g3-smoke" tests="${suites.length}" failures="${failedItems.length}">${suites.map((suite) => `<testcase name="${suite.name}" time="${suite.wallSeconds}">${suite.status === "PASS" ? "" : `<failure message="${suite.status}"><![CDATA[${cdata(suite.output)}]]></failure>`}</testcase>`).join("")}</testsuite>\n`;
const report = `<!doctype html><html lang="en"><meta charset="utf-8"><title>HVE-G3 smoke</title><body><h1>HVE-G3 smoke: ${status}</h1><p>Not a production approval.</p><pre>${JSON.stringify(metrics, null, 2).replaceAll("<", "&lt;")}</pre></body></html>\n`;
await Promise.all([
  writeFile(path.join(outputDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "environment.json"), `${JSON.stringify(environment, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "failed-items.json"), `${JSON.stringify(failedItems, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "junit.xml"), junit),
  writeFile(path.join(outputDirectory, "report.html"), report),
]);
console.log(`HVE-G3 smoke ${status}: ${outputDirectory}`);
process.exit(status === "PASS" ? 0 : status === "INSUFFICIENT" ? 2 : 1);
