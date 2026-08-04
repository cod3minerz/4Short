import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runWorkerUnittest, workerTestRuntimeDescription } from "./worker-unittest.mjs";

/**
 * Inspectable HVE-5 smoke evidence. It validates only the sparse-source and
 * director slice; the release gate still requires active-speaker corpus and
 * hardware evidence, so this file can never by itself enable an HVE feature.
 */
const outputArgument = process.argv.find((argument) => argument.startsWith("--output-dir="));
const outputDirectory = path.resolve(
  outputArgument?.slice("--output-dir=".length)
    ?? path.join("outputs", "hve", "hve-g5-smoke", new Date().toISOString().replaceAll(":", "-")),
);
await mkdir(outputDirectory, { recursive: true });

function run(name, executable, args, options = {}) {
  const startedAt = performance.now();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`;
  return {
    name,
    command: [executable, ...args].join(" "),
    status: result.status === 0 && !result.error ? "PASS" : result.status === 2 ? "INSUFFICIENT" : "FAIL",
    wallSeconds: Number(((performance.now() - startedAt) / 1_000).toFixed(3)),
    output,
  };
}

function classifyEvidenceStatus(suite) {
  // HVE-G5 has no right to claim visual evidence when this machine cannot run
  // the worker's OpenCV/Pydantic dependency set. CI installs that image; a
  // detector assertion failure there remains a FAIL.
  if (/ModuleNotFoundError: No module named '(?:pydantic_settings|cv2|numpy|boto3|faster_whisper)'/i.test(suite.output)
    || /VISION_RUNTIME_MISSING|FACE_RUNTIME_MISSING/i.test(suite.output)) {
    suite.status = "INSUFFICIENT";
    return;
  }
  if (/skipped(?:=|\s+)(?!0\b)\d+/i.test(suite.output)) suite.status = "INSUFFICIENT";
}

const nodeBinary = process.execPath;
const corpusManifest = process.env.HVE_G5_CORPUS_MANIFEST;
const corpusObjectIndex = process.env.HVE_CORPUS_OBJECT_INDEX;
const corpusPublicKey = process.env.HVE_CORPUS_INDEX_PUBLIC_KEY_FILE;
const activeSpeakerLabels = process.env.HVE_G5_ACTIVE_SPEAKER_LABELS;
const activeSpeakerPredictions = process.env.HVE_G5_ACTIVE_SPEAKER_PREDICTIONS;
const activeSpeakerReport = path.join(outputDirectory, "active-speaker-benchmark.json");
const corpusEvidence = (!corpusManifest || !corpusObjectIndex || !corpusPublicKey)
  ? {
      name: "active_speaker_corpus_integrity",
      command: "scripts/hve/validate-corpus.mjs <ready signed corpus>",
      status: "INSUFFICIENT",
      wallSeconds: 0,
      output: "Provide HVE_G5_CORPUS_MANIFEST, HVE_CORPUS_OBJECT_INDEX and HVE_CORPUS_INDEX_PUBLIC_KEY_FILE.",
    }
  : run("active_speaker_corpus_integrity", nodeBinary, [
      "scripts/hve/validate-corpus.mjs",
      corpusManifest,
      `--object-index=${corpusObjectIndex}`,
      `--public-key=${corpusPublicKey}`,
    ]);
const hasActiveSpeakerEvidence = Boolean(
  corpusManifest
  && corpusObjectIndex
  && corpusPublicKey
  && activeSpeakerLabels
  && activeSpeakerPredictions,
);
const activeSpeakerEvaluation = hasActiveSpeakerEvidence
  ? run("active_speaker_evaluation", nodeBinary, [
      "scripts/hve/evaluate-active-speaker-benchmark.mjs",
      `--manifest=${corpusManifest}`,
      `--object-index=${corpusObjectIndex}`,
      `--public-key=${corpusPublicKey}`,
      `--labels=${activeSpeakerLabels}`,
      `--predictions=${activeSpeakerPredictions}`,
      `--out=${activeSpeakerReport}`,
    ])
  : {
      name: "active_speaker_evaluation",
      command: "scripts/hve/evaluate-active-speaker-benchmark.mjs <signed ready corpus + evaluator labels + predictions>",
      status: "INSUFFICIENT",
      wallSeconds: 0,
      output: "Provide HVE_G5_CORPUS_MANIFEST, HVE_CORPUS_OBJECT_INDEX, HVE_CORPUS_INDEX_PUBLIC_KEY_FILE, HVE_G5_ACTIVE_SPEAKER_LABELS and HVE_G5_ACTIVE_SPEAKER_PREDICTIONS.",
    };
const benchmarkEvidence = hasActiveSpeakerEvidence && activeSpeakerEvaluation.status === "PASS"
  ? run(
      "active_speaker_benchmark",
      nodeBinary,
      ["scripts/hve/validate-active-speaker-benchmark.mjs", `--report=${activeSpeakerReport}`],
    )
  : {
      name: "active_speaker_benchmark",
      command: "scripts/hve/validate-active-speaker-benchmark.mjs --report=<evaluator-report>",
      status: "INSUFFICIENT",
      wallSeconds: 0,
      output: hasActiveSpeakerEvidence
        ? "The evaluator did not produce a valid signed-evidence report."
        : "No signed evaluator report can exist until all active-speaker evidence inputs are supplied.",
    };
const suites = [
  run("perception_contract", nodeBinary, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-perception.test.ts"]),
  run("director_evidence_policy", nodeBinary, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-director.test.ts"]),
  // Sparse perception is a worker capability. When an immutable worker image
  // is available, execute both policy and OpenCV decode checks inside it;
  // host Python is only a local-development fallback and is recorded as such.
  runWorkerUnittest("active_speaker_association_policy", { file: "test_association.py" }),
  runWorkerUnittest("sparse_source_decode", { file: "test_vision.py" }),
  corpusEvidence,
  activeSpeakerEvaluation,
  benchmarkEvidence,
];

for (const suite of suites) classifyEvidenceStatus(suite);
const status = suites.some((suite) => suite.status === "FAIL")
  ? "FAIL"
  : suites.some((suite) => suite.status === "INSUFFICIENT") ? "INSUFFICIENT" : "PASS";
const failedItems = suites.filter((suite) => suite.status !== "PASS")
  .map((suite) => ({ suite: suite.command, status: suite.status, output: suite.output.slice(-8_000) }));
const environment = {
  os: `${os.type()} ${os.release()}`,
  arch: process.arch,
  node: process.version,
  workerTestRuntime: workerTestRuntimeDescription(),
  ffmpeg: run("ffmpeg", "ffmpeg", ["-version"]),
  generatedAt: new Date().toISOString(),
  scope: "HVE-G5 sparse scene graph, association contract and director smoke. Active-speaker promotion additionally requires a ready signed corpus, benchmark report and Timeweb CPU8/12GB measurements.",
};
const metrics = {
  schemaVersion: 1,
  status,
  runId: `hve-g5-smoke-${Date.now()}`,
  createdAt: new Date().toISOString(),
  candidate: { renderer: "not-selected", planner: "@4short/contracts hve-director", perception: "SparseSourcePerception" },
  environment,
  suites: suites.map(({ name, command, status: suiteStatus, wallSeconds }) => ({ name, command, status: suiteStatus, wallSeconds })),
  requiredEvidenceStillMissing: [
    "licensed active-speaker corpus with independent annotations",
    "signed corpus integrity plus evaluator-signed diarization and audio-video association benchmark",
    "screen/gameplay region detector corpus and visual goldens",
    "Timeweb CPU8/12GB source-analysis resource benchmark",
  ],
};
const cdata = (value) => value.replaceAll("]]>", "]]]]><![CDATA[>");
const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="hve-g5-smoke" tests="${suites.length}" failures="${failedItems.length}">${suites.map((suite) => `<testcase name="${suite.name}" time="${suite.wallSeconds}">${suite.status === "PASS" ? "" : `<failure message="${suite.status}"><![CDATA[${cdata(suite.output)}]]></failure>`}</testcase>`).join("")}</testsuite>\n`;
const report = `<!doctype html><html lang="en"><meta charset="utf-8"><title>HVE-G5 smoke</title><body><h1>HVE-G5 smoke: ${status}</h1><p>Not a production release approval.</p><pre>${JSON.stringify(metrics, null, 2).replaceAll("<", "&lt;")}</pre></body></html>\n`;
await Promise.all([
  writeFile(path.join(outputDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "environment.json"), `${JSON.stringify(environment, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "failed-items.json"), `${JSON.stringify(failedItems, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "junit.xml"), junit),
  writeFile(path.join(outputDirectory, "report.html"), report),
]);
console.log(`HVE-G5 smoke ${status}: ${outputDirectory}`);
process.exit(status === "PASS" ? 0 : status === "INSUFFICIENT" ? 2 : 1);
