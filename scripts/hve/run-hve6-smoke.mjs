import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runWorkerUnittest, workerTestRuntimeDescription } from "./worker-unittest.mjs";

/**
 * Evidence for HVE-6's already executable, user-verified screen/gameplay
 * route. It proves that the generic slot compositor places a dense face crop
 * above a manually confirmed screen/gameplay crop, or into an explicitly
 * assigned 3-person panel grid, and the resulting MP4 is decodable. It never
 * claims automatic region detection or production parity.
 */
const argument = process.argv.find((value) => value.startsWith("--output-dir="));
const outputDirectory = path.resolve(argument?.slice("--output-dir=".length)
  ?? path.join("outputs", "hve", "hve-g6-smoke", new Date().toISOString().replaceAll(":", "-")));
await mkdir(outputDirectory, { recursive: true });

function run(name, executable, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options,
  });
  return {
    name,
    command: [executable, ...args].join(" "),
    // Verification validators use exit 2 for missing evidence.  Preserve it
    // as INSUFFICIENT so the smoke report distinguishes an intentionally
    // locked capability from a broken compositor or detector assertion.
    status: result.status === 0 && !result.error ? "PASS" : result.status === 2 ? "INSUFFICIENT" : "FAIL",
    wallSeconds: Number(((performance.now() - started) / 1_000).toFixed(3)),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`,
  };
}

function classify(suite) {
  if (/ModuleNotFoundError: No module named '(?:pydantic_settings|cv2|numpy|boto3|httpx)'/i.test(suite.output)
    || /skipped(?:=|\s+)(?!0\b)\d+/i.test(suite.output)) suite.status = "INSUFFICIENT";
}

const renderTest = (name, pattern) => runWorkerUnittest(name, { file: "test_render.py", pattern });
const layoutCorpusEvidence = process.env.HVE_G6_CORPUS_MANIFEST
  && process.env.HVE_CORPUS_OBJECT_INDEX
  && process.env.HVE_CORPUS_INDEX_PUBLIC_KEY_FILE
  ? run("layout_director_corpus_integrity", process.execPath, [
    "scripts/hve/validate-corpus.mjs",
    process.env.HVE_G6_CORPUS_MANIFEST,
    `--object-index=${process.env.HVE_CORPUS_OBJECT_INDEX}`,
    `--public-key=${process.env.HVE_CORPUS_INDEX_PUBLIC_KEY_FILE}`,
  ])
  : {
    name: "layout_director_corpus_integrity",
    command: "scripts/hve/validate-corpus.mjs <ready HVE_G6 corpus>",
    status: "INSUFFICIENT",
    wallSeconds: 0,
    output: "INSUFFICIENT: HVE_G6_CORPUS_MANIFEST, HVE_CORPUS_OBJECT_INDEX and HVE_CORPUS_INDEX_PUBLIC_KEY_FILE are required.",
  };
// G6 is intentionally an evaluator-only route. A benchmark summary that
// happens to exist on disk is not evidence: the evaluator must derive it
// from the exact ready corpus plus signed labels/predictions and sign the
// result once more. The private key is never set in application, worker or CI
// environments, so normal smoke runs remain fail-closed INSUFFICIENT.
const layoutLabels = process.env.HVE_G6_LAYOUT_LABELS;
const layoutPredictions = process.env.HVE_G6_LAYOUT_PREDICTIONS;
const layoutEvaluatorPrivateKey = process.env.HVE_G6_EVALUATOR_PRIVATE_KEY_FILE;
const layoutBenchmarkReport = path.join(outputDirectory, "layout-director-benchmark.signed.json");
const hasLayoutDirectorEvidence = Boolean(
  process.env.HVE_G6_CORPUS_MANIFEST
  && process.env.HVE_CORPUS_OBJECT_INDEX
  && process.env.HVE_CORPUS_INDEX_PUBLIC_KEY_FILE
  && layoutLabels
  && layoutPredictions
  && layoutEvaluatorPrivateKey,
);
// Do not even derive a signed report from malformed or unverified corpus
// facts. The evaluator command independently checks bindings too, but this
// ordering prevents a smoke run from leaving a seemingly authoritative
// benchmark artifact behind after corpus integrity failed.
const canEvaluateLayoutDirector = hasLayoutDirectorEvidence && layoutCorpusEvidence.status === "PASS";
const layoutDirectorEvaluation = canEvaluateLayoutDirector
  ? run("layout_director_evaluation", process.execPath, [
      "scripts/hve/evaluate-layout-director-benchmark.mjs",
      `--manifest=${process.env.HVE_G6_CORPUS_MANIFEST}`,
      `--object-index=${process.env.HVE_CORPUS_OBJECT_INDEX}`,
      `--public-key=${process.env.HVE_CORPUS_INDEX_PUBLIC_KEY_FILE}`,
      `--private-key=${layoutEvaluatorPrivateKey}`,
      `--labels=${layoutLabels}`,
      `--predictions=${layoutPredictions}`,
      `--out=${layoutBenchmarkReport}`,
    ])
  : {
      name: "layout_director_evaluation",
      command: "scripts/hve/evaluate-layout-director-benchmark.mjs <ready signed corpus + evaluator labels + predictions + private evaluator key>",
      status: "INSUFFICIENT",
      wallSeconds: 0,
      output: hasLayoutDirectorEvidence
        ? "INSUFFICIENT: corpus integrity did not pass; evaluator scoring is not permitted."
        : "INSUFFICIENT: provide HVE_G6_CORPUS_MANIFEST, HVE_CORPUS_OBJECT_INDEX, HVE_CORPUS_INDEX_PUBLIC_KEY_FILE, HVE_G6_LAYOUT_LABELS, HVE_G6_LAYOUT_PREDICTIONS and HVE_G6_EVALUATOR_PRIVATE_KEY_FILE in an evaluator-only environment.",
    };
const layoutBenchmarkEvidence = canEvaluateLayoutDirector && layoutDirectorEvaluation.status === "PASS"
  ? run(
      "layout_director_benchmark",
      process.execPath,
      [
        "scripts/hve/validate-layout-director-benchmark.mjs",
        `--report=${layoutBenchmarkReport}`,
        `--public-key=${process.env.HVE_CORPUS_INDEX_PUBLIC_KEY_FILE}`,
      ],
    )
  : {
      name: "layout_director_benchmark",
      command: "scripts/hve/validate-layout-director-benchmark.mjs --report=<evaluator-signed-report> --public-key=<evaluator-public-key>",
      status: "INSUFFICIENT",
      wallSeconds: 0,
      output: hasLayoutDirectorEvidence
        ? "INSUFFICIENT: the evaluator did not produce a signed layout-director benchmark report."
        : "INSUFFICIENT: no signed layout-director report can exist until every evaluator-only input is supplied.",
    };
const suites = [
  run("layout_crop_tracking_user_verified", process.execPath, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-layout.test.ts"]),
  run("draft_user_verified_grid_command", process.execPath, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-editor-commands.test.ts"]),
  run("director_refuses_unverified_gameplay", process.execPath, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-director.test.ts"]),
  run("editor_parity_user_verified", process.execPath, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-preview.test.ts"]),
  renderTest("generic_gameplay_slot_compositor", "hve6_user_verified_gameplay_composite_executes_top_and_bottom_slots"),
  renderTest("generic_three_person_grid_compositor", "hve6_user_verified_three_person_grid_executes_all_slots"),
  renderTest("generic_four_person_grid_compositor", "hve6_user_verified_four_person_grid_executes_all_slots"),
  layoutCorpusEvidence,
  layoutDirectorEvaluation,
  layoutBenchmarkEvidence,
];
for (const suite of suites) classify(suite);

const status = suites.some((suite) => suite.status === "FAIL") ? "FAIL"
  : suites.some((suite) => suite.status === "INSUFFICIENT") ? "INSUFFICIENT" : "PASS";
const failedItems = suites.filter((suite) => suite.status !== "PASS")
  .map((suite) => ({ suite: suite.name, status: suite.status, output: suite.output.slice(-8_000) }));
const environment = {
  os: `${os.type()} ${os.release()}`,
  arch: process.arch,
  node: process.version,
  workerTestRuntime: workerTestRuntimeDescription(),
  ffmpeg: run("ffmpeg", "ffmpeg", ["-version"]),
  generatedAt: new Date().toISOString(),
  scope: "HVE-G6 executable user-verified composition plus automatic-region promotion evidence. Automatic screen/gameplay direction remains disabled unless the signed corpus and benchmark gates pass.",
};
const metrics = {
  schemaVersion: 1,
  status,
  runId: `hve-g6-smoke-${Date.now()}`,
  createdAt: new Date().toISOString(),
  candidate: {
    planner: "@4short/contracts user-verified composite slot builders",
    renderer: "fourshort_worker.render.compile_resolved_layout_filter",
  },
  environment,
  suites: suites.map(({ name, command, status: suiteStatus, wallSeconds }) => ({ name, command, status: suiteStatus, wallSeconds })),
  requiredEvidenceStillMissing: [
    "licensed screen/gameplay/facecam corpus with independent region annotations",
    "automatic region detector precision/recall and per-stratum layout benchmarks",
    "browser/FFmpeg geometry parity for the composition player",
    "Timeweb CPU8/12GB dense-perception and render resource benchmark",
  ],
};
const cdata = (value) => value.replaceAll("]]>", "]]]]><![CDATA[>");
const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="hve-g6-smoke" tests="${suites.length}" failures="${failedItems.length}">${suites.map((suite) => `<testcase name="${suite.name}" time="${suite.wallSeconds}">${suite.status === "PASS" ? "" : `<failure message="${suite.status}"><![CDATA[${cdata(suite.output)}]]></failure>`}</testcase>`).join("")}</testsuite>\n`;
const report = `<!doctype html><html lang="en"><meta charset="utf-8"><title>HVE-G6 smoke</title><body><h1>HVE-G6 user-verified composition smoke: ${status}</h1><p>Not an automatic-region or production approval.</p><pre>${JSON.stringify(metrics, null, 2).replaceAll("<", "&lt;")}</pre></body></html>\n`;
await Promise.all([
  writeFile(path.join(outputDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "environment.json"), `${JSON.stringify(environment, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "failed-items.json"), `${JSON.stringify(failedItems, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "junit.xml"), junit),
  writeFile(path.join(outputDirectory, "report.html"), report),
]);
console.log(`HVE-G6 smoke ${status}: ${outputDirectory}`);
process.exit(status === "PASS" ? 0 : status === "INSUFFICIENT" ? 2 : 1);
