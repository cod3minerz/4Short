import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Validates the compact evaluator report required to promote HVE active
 * speaker handling.  This is intentionally separate from model code: a
 * passing unit suite or a self-reported model benchmark must never enable an
 * active-speaker capability without corpus and Timeweb evidence.
 */
const reportArgument = process.argv.find((argument) => argument.startsWith("--report="));
const reportPath = reportArgument?.slice("--report=".length) ?? process.env.HVE_G5_BENCHMARK_REPORT;

if (!reportPath) {
  console.error("INSUFFICIENT: provide --report=<active-speaker-benchmark.json> or HVE_G5_BENCHMARK_REPORT.");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(await readFile(path.resolve(reportPath), "utf8"));
} catch (error) {
  console.error(`ERROR: cannot read active-speaker benchmark report: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

const errors = [];
const insufficiencies = [];
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const ratio = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const nonNegativeNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function error(message) {
  errors.push(message);
}

function insufficient(message) {
  insufficiencies.push(message);
}

if (!record(report)) {
  error("report must be an object");
} else {
  if (report.schemaVersion !== 1) error("schemaVersion must equal 1");
  if (report.kind !== "hve-active-speaker-benchmark-v1") error("kind must equal hve-active-speaker-benchmark-v1");
  if (report.status !== "pass") error("status must equal pass; a candidate or partial run is not promotion evidence");
  if (!record(report.corpus)) error("corpus evidence is missing");
  else {
    if (typeof report.corpus.version !== "string" || report.corpus.version.length < 3) error("corpus.version is invalid");
    if (!hash(report.corpus.signedObjectIndexSha256)) insufficient("corpus.signedObjectIndexSha256 is absent or invalid");
    if (!hash(report.corpus.evaluatorKeyFingerprint)) insufficient("corpus.evaluatorKeyFingerprint is absent or invalid");
  }
  if (!record(report.candidate)) error("candidate model provenance is missing");
  else {
    for (const field of ["diarizationEngine", "diarizationModelVersion", "mouthEngine", "mouthModelVersion"]) {
      if (typeof report.candidate[field] !== "string" || report.candidate[field].length < 2) error(`candidate.${field} is invalid`);
    }
    for (const field of ["diarizationModelSha256", "mouthModelSha256", "associationCodeSha256"]) {
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
      clean_two_person: { f1: 0.92, minimumItems: 24, minimumTurns: 120 },
      panel_hard: { f1: 0.85, minimumItems: 24, minimumTurns: 120 },
    };
    for (const [stratum, thresholds] of Object.entries(required)) {
      const value = report.strata[stratum];
      if (!record(value)) {
        insufficient(`strata.${stratum} is missing`);
        continue;
      }
      if (!positiveInteger(value.items)) insufficient(`strata.${stratum}.items is missing`);
      else if (value.items < thresholds.minimumItems) insufficient(`strata.${stratum}.items must include at least ${thresholds.minimumItems} independently sourced corpus items`);
      if (!positiveInteger(value.samples)) insufficient(`strata.${stratum}.samples is missing`);
      else if (value.samples < thresholds.minimumTurns) insufficient(`strata.${stratum}.samples must include at least ${thresholds.minimumTurns} adjudicated turns`);
      if (!ratio(value.activeSpeakerF1)) error(`strata.${stratum}.activeSpeakerF1 must be a ratio`);
      else if (value.activeSpeakerF1 < thresholds.f1) error(`strata.${stratum}.activeSpeakerF1 is below ${thresholds.f1}`);
      if (!ratio(value.visibleSpeakerCoverage)) insufficient(`strata.${stratum}.visibleSpeakerCoverage is missing`);
      else if (value.visibleSpeakerCoverage < 0.98) error(`strata.${stratum}.visibleSpeakerCoverage is below 0.98`);
    }
  }
  if (!record(report.safety)) error("safety results are missing");
  else {
    if (!ratio(report.safety.offscreenFalseAssignmentRate)) error("safety.offscreenFalseAssignmentRate must be a ratio");
    else if (report.safety.offscreenFalseAssignmentRate > 0.02) error("safety.offscreenFalseAssignmentRate exceeds 0.02");
    if (!nonNegativeNumber(report.safety.p95SwitchLatencyMs)) error("safety.p95SwitchLatencyMs must be non-negative");
    else if (report.safety.p95SwitchLatencyMs > 600) error("safety.p95SwitchLatencyMs exceeds 600 ms");
    if (!ratio(report.safety.unresolvedSwitchRate)) insufficient("safety.unresolvedSwitchRate is missing");
    else if (report.safety.unresolvedSwitchRate > 0.02) error("safety.unresolvedSwitchRate exceeds 0.02");
  }
  if (!record(report.resources)) error("resource results are missing");
  else {
    if (!nonNegativeNumber(report.resources.p95DenseAnalysisRssBytes)) error("resources.p95DenseAnalysisRssBytes must be non-negative");
    else if (report.resources.p95DenseAnalysisRssBytes > 9 * 1024 ** 3) error("resources.p95DenseAnalysisRssBytes exceeds 9 GiB");
    if (!nonNegativeNumber(report.resources.sustainedSwapBytes)) error("resources.sustainedSwapBytes must be non-negative");
    else if (report.resources.sustainedSwapBytes > 0) error("resources.sustainedSwapBytes must be zero");
  }
  if (!record(report.evaluation)) {
    insufficient("evaluation provenance is missing; use hve:evaluate:active-speaker from an evaluator-only environment");
  } else {
    if (report.evaluation.evaluatorVersion !== "hve-active-speaker-evaluator-v1") insufficient("evaluation.evaluatorVersion is invalid");
    if (!positiveInteger(report.evaluation.itemsEvaluated) || !positiveInteger(report.evaluation.turnsEvaluated)) {
      insufficient("evaluation item/turn counts are missing");
    }
    if (!Array.isArray(report.evaluation.failureSamples)) insufficient("evaluation.failureSamples is missing");
    for (const field of ["predictionBundleSha256", "labelBundleSha256"]) {
      if (!hash(report.evaluation[field])) insufficient(`evaluation.${field} is absent or invalid`);
    }
  }
}

if (errors.length) {
  console.error(`HVE-G5 active-speaker benchmark failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  errors.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
if (insufficiencies.length) {
  console.error(`HVE-G5 active-speaker benchmark evidence is insufficient (${insufficiencies.length} issue${insufficiencies.length === 1 ? "" : "s"}):`);
  insufficiencies.forEach((item) => console.error(`- ${item}`));
  process.exit(2);
}
console.log(`HVE-G5 active-speaker benchmark verified: ${report.corpus.version}`);
