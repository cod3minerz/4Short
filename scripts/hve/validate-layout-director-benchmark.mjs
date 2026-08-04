import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { verifyCorpusIndex } from "./corpus-index.mjs";

/**
 * The only promotion boundary for automatic HVE-6 region/layout direction.
 *
 * A working slot compositor or a developer's local CV sample is deliberately
 * not enough: this validator requires a versioned, independently labelled
 * corpus and measurements from the production worker envelope.  Until it
 * receives such a report, HVE may offer only the explicitly user-verified
 * screen/gameplay and panel routes.
 */
const reportArgument = process.argv.find((argument) => argument.startsWith("--report="));
const reportPath = reportArgument?.slice("--report=".length) ?? process.env.HVE_G6_BENCHMARK_REPORT;
const publicKeyArgument = process.argv.find((argument) => argument.startsWith("--public-key="));
const publicKeyPath = publicKeyArgument?.slice("--public-key=".length) ?? process.env.HVE_G6_EVALUATOR_PUBLIC_KEY_FILE;

if (!reportPath) {
  console.error("INSUFFICIENT: provide --report=<layout-director-benchmark.json> or HVE_G6_BENCHMARK_REPORT.");
  process.exit(2);
}
if (!publicKeyPath) {
  console.error("INSUFFICIENT: provide --public-key=<evaluator-public.pem> or HVE_G6_EVALUATOR_PUBLIC_KEY_FILE; unsigned benchmark reports cannot promote automatic layouts.");
  process.exit(2);
}

let report;
let publicKey;
try {
  [report, publicKey] = await Promise.all([
    readFile(path.resolve(reportPath), "utf8").then(JSON.parse),
    readFile(path.resolve(publicKeyPath), "utf8"),
  ]);
} catch (error) {
  console.error(`ERROR: cannot read layout-director benchmark report/public key: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

const errors = [];
const insufficiencies = [];
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const ratio = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const nonNegativeNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const error = (message) => errors.push(message);
const insufficient = (message) => insufficiencies.push(message);

function checkRatio(value, field, minimum) {
  if (!ratio(value)) error(`${field} must be a ratio`);
  else if (value < minimum) error(`${field} is below ${minimum}`);
}

if (!record(report)) {
  error("report must be an object");
} else {
  if (!verifyCorpusIndex(report, publicKey)) {
    error("report must carry a valid Ed25519 signature from the evaluator public key");
  }
  if (report.schemaVersion !== 1) error("schemaVersion must equal 1");
  if (report.kind !== "hve-layout-director-benchmark-v1") error("kind must equal hve-layout-director-benchmark-v1");
  if (report.status !== "pass") error("status must equal pass; partial detector results are not promotion evidence");

  if (!record(report.corpus)) error("corpus evidence is missing");
  else {
    if (typeof report.corpus.version !== "string" || report.corpus.version.length < 3) error("corpus.version is invalid");
    if (!hash(report.corpus.signedObjectIndexSha256)) insufficient("corpus.signedObjectIndexSha256 is absent or invalid");
    if (!hash(report.corpus.evaluatorKeyFingerprint)) insufficient("corpus.evaluatorKeyFingerprint is absent or invalid");
    if (!hash(report.corpus.annotationSetSha256)) insufficient("corpus.annotationSetSha256 is absent or invalid");
  }

  if (!record(report.candidate)) error("candidate provenance is missing");
  else {
    for (const field of ["regionDetector", "regionModelVersion", "faceDetector", "faceModelVersion", "directorVersion"]) {
      if (typeof report.candidate[field] !== "string" || report.candidate[field].length < 2) error(`candidate.${field} is invalid`);
    }
    for (const field of ["regionModelSha256", "faceModelSha256", "directorCodeSha256"]) {
      if (!hash(report.candidate[field])) insufficient(`candidate.${field} is absent or invalid`);
    }
  }

  if (!record(report.hardware)) error("hardware profile is missing");
  else {
    if (report.hardware.profile !== "timeweb-cpu8-12gb") insufficient("hardware.profile must be timeweb-cpu8-12gb for promotion");
    if (!positiveInteger(report.hardware.cpuCount) || report.hardware.cpuCount < 8) insufficient("hardware.cpuCount must record the target 8 CPU worker");
    if (!positiveInteger(report.hardware.memoryBytes) || report.hardware.memoryBytes < 12 * 1024 ** 3) insufficient("hardware.memoryBytes must record at least 12 GiB");
  }

  if (!record(report.strata)) error("per-stratum results are missing");
  else {
    const required = {
      screen_presenter: { screenRegionRecall: 0.95, faceRegionRecall: 0.9, layoutAccuracy: 0.92, minimumItems: 24, minimumSamples: 120 },
      gameplay_facecam: { screenRegionRecall: 0.95, faceRegionRecall: 0.9, layoutAccuracy: 0.92, minimumItems: 24, minimumSamples: 120 },
      panel_three_four: { panelTrackRecall: 0.9, layoutAccuracy: 0.9, minimumItems: 24, minimumSamples: 120 },
    };
    for (const [stratum, thresholds] of Object.entries(required)) {
      const value = report.strata[stratum];
      if (!record(value)) {
        insufficient(`strata.${stratum} is missing`);
        continue;
      }
      if (!positiveInteger(value.samples)) insufficient(`strata.${stratum}.samples is missing`);
      else if (value.samples < thresholds.minimumSamples) insufficient(`strata.${stratum}.samples must include at least ${thresholds.minimumSamples} independently labelled ranges`);
      if (!positiveInteger(value.items)) insufficient(`strata.${stratum}.items is missing`);
      else if (value.items < thresholds.minimumItems) insufficient(`strata.${stratum}.items must include at least ${thresholds.minimumItems} independently sourced corpus items`);
      for (const [field, minimum] of Object.entries(thresholds)) {
        if (field === "minimumItems" || field === "minimumSamples") continue;
        checkRatio(value[field], `strata.${stratum}.${field}`, minimum);
      }
    }
  }

  if (!record(report.safety)) error("safety results are missing");
  else {
    if (!ratio(report.safety.forbiddenLayoutRate)) error("safety.forbiddenLayoutRate must be a ratio");
    else if (report.safety.forbiddenLayoutRate > 0) error("safety.forbiddenLayoutRate must equal zero");
    if (!ratio(report.safety.importantScreenCropLossRate)) error("safety.importantScreenCropLossRate must be a ratio");
    else if (report.safety.importantScreenCropLossRate > 0.02) error("safety.importantScreenCropLossRate exceeds 0.02");
    if (!nonNegativeNumber(report.safety.p95LayoutTransitionLatencyMs)) error("safety.p95LayoutTransitionLatencyMs must be non-negative");
    else if (report.safety.p95LayoutTransitionLatencyMs > 600) error("safety.p95LayoutTransitionLatencyMs exceeds 600 ms");
  }

  if (!record(report.resources)) error("resource results are missing");
  else {
    if (!nonNegativeNumber(report.resources.p95DenseAnalysisRssBytes)) error("resources.p95DenseAnalysisRssBytes must be non-negative");
    else if (report.resources.p95DenseAnalysisRssBytes > 9 * 1024 ** 3) error("resources.p95DenseAnalysisRssBytes exceeds 9 GiB");
    if (!nonNegativeNumber(report.resources.sustainedSwapBytes)) error("resources.sustainedSwapBytes must be non-negative");
    else if (report.resources.sustainedSwapBytes > 0) error("resources.sustainedSwapBytes must be zero");
  }
  if (!record(report.evaluation)) {
    insufficient("evaluation provenance is missing; use hve:evaluate:layout-director from an evaluator-only environment");
  } else {
    if (report.evaluation.evaluatorVersion !== "hve-layout-director-evaluator-v1") insufficient("evaluation.evaluatorVersion is invalid");
    if (!positiveInteger(report.evaluation.itemsEvaluated) || !positiveInteger(report.evaluation.rangesEvaluated)) {
      insufficient("evaluation item/range counts are missing");
    }
    if (!Array.isArray(report.evaluation.failureSamples)) insufficient("evaluation.failureSamples is missing");
    if (!ratio(report.evaluation.requiredRegionRecall)) insufficient("evaluation.requiredRegionRecall is missing");
    for (const field of ["predictionBundleSha256", "labelBundleSha256"]) {
      if (!hash(report.evaluation[field])) insufficient(`evaluation.${field} is absent or invalid`);
    }
  }
}

if (errors.length) {
  console.error(`HVE-G6 automatic-layout benchmark failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  errors.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
if (insufficiencies.length) {
  console.error(`HVE-G6 automatic-layout benchmark evidence is insufficient (${insufficiencies.length} issue${insufficiencies.length === 1 ? "" : "s"}):`);
  insufficiencies.forEach((item) => console.error(`- ${item}`));
  process.exit(2);
}
console.log(`HVE-G6 automatic-layout benchmark verified: ${report.corpus.version}`);
