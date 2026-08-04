import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { canonicalJson, verifyCorpusIndex } from "./corpus-index.mjs";

const EXIT = { PASS: 0, FAIL: 1, INSUFFICIENT: 2, ERROR: 3 };
const args = process.argv.slice(2);
const option = (name) => args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const evidenceDirectory = option("--evidence-dir");
const thresholdPath = path.resolve(option("--thresholds") ?? "verification/hve/thresholds/production-v1.json");
const publicKeyPath = option("--public-key") ?? process.env.HVE_RELEASE_EVALUATOR_PUBLIC_KEY_FILE;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("..")
    && !value.includes("\\")
    && !value.includes("//")
    && !value.includes(":")
    && !/[\u0000-\u001f]/.test(value);
}

async function readJson(file) {
  const bytes = await readFile(file);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function validateEvidenceShape(evidence, thresholds) {
  const errors = [];
  const requiredKeys = new Set([
    "schemaVersion", "kind", "thresholdVersion", "candidate", "corpus", "metrics", "baseline", "artifacts", "signedAt", "signature",
  ]);
  if (!isRecord(evidence)) return ["release evidence must be an object"];
  const unknown = Object.keys(evidence).filter((key) => !requiredKeys.has(key));
  const missing = [...requiredKeys].filter((key) => !Object.prototype.hasOwnProperty.call(evidence, key));
  if (unknown.length || missing.length) {
    if (unknown.length) errors.push(`release evidence has unknown top-level fields: ${unknown.join(", ")}`);
    if (missing.length) errors.push(`release evidence is missing top-level fields: ${missing.join(", ")}`);
    return errors;
  }
  if (evidence.schemaVersion !== 1 || evidence.kind !== "hve-production-evidence") errors.push("not an hve-production-evidence v1 report");
  if (evidence.thresholdVersion !== thresholds.name) errors.push("thresholdVersion does not match the frozen threshold file");
  if (!isRecord(evidence.candidate) || Object.keys(evidence.candidate).some((key) => !["gitSha", "imageDigest"].includes(key))
    || !/^[a-f0-9]{40}$/.test(evidence.candidate.gitSha ?? "") || !/^sha256:[a-f0-9]{64}$/.test(evidence.candidate.imageDigest ?? "")) {
    errors.push("candidate must bind a full git SHA and immutable OCI image digest");
  }
  if (!isRecord(evidence.artifacts)) errors.push("artifacts must be a relative-path SHA-256 map");
  else {
    for (const [artifact, hash] of Object.entries(evidence.artifacts)) {
      if (!safeRelativePath(artifact) || !/^[a-f0-9]{64}$/.test(hash)) errors.push(`artifact binding is malformed: ${artifact}`);
    }
  }
  if (typeof evidence.signedAt !== "string" || !Number.isFinite(Date.parse(evidence.signedAt))) errors.push("signedAt must be a valid timestamp");
  return errors;
}

function validateCorpus(errors, insufficient, corpus, gate) {
  if (!isRecord(corpus) || !isRecord(corpus.splits) || !isRecord(corpus.strata)) {
    insufficient.push("corpus split/stratum evidence is missing");
    return;
  }
  const splitCounts = [];
  for (const split of gate.requiredSplits ?? []) {
    const fact = corpus.splits[split];
    if (!isRecord(fact) || !Number.isSafeInteger(fact.sourceCount) || fact.sourceCount <= 0 || !Number.isSafeInteger(fact.annotatedRangeCount) || fact.annotatedRangeCount <= 0) {
      insufficient.push(`corpus split ${split} is missing source/range counts`);
      continue;
    }
    if (typeof fact.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(fact.manifestSha256)) insufficient.push(`corpus split ${split} is not bound to a manifest hash`);
    if (split === "holdout" && fact.sealed !== true) errors.push("holdout corpus is not declared sealed");
    splitCounts.push(fact);
  }
  const totalSources = splitCounts.reduce((total, split) => total + split.sourceCount, 0);
  const totalRanges = splitCounts.reduce((total, split) => total + split.annotatedRangeCount, 0);
  if (!Number.isSafeInteger(corpus.sourceCount) || corpus.sourceCount !== totalSources || corpus.sourceCount < gate.minimumCorpus.sourceCount) insufficient.push("corpus source count is missing, inconsistent, or below the frozen minimum");
  if (!Number.isSafeInteger(corpus.annotatedRangeCount) || corpus.annotatedRangeCount !== totalRanges || corpus.annotatedRangeCount < gate.minimumCorpus.annotatedRangeCount) insufficient.push("corpus range count is missing, inconsistent, or below the frozen minimum");
  if (!finite(corpus.durationHours) || corpus.durationHours < gate.minimumCorpus.durationHours) insufficient.push("corpus duration is below the frozen minimum");
  if (!finite(corpus.russianRatio) || corpus.russianRatio < gate.minimumCorpus.russianRatio) insufficient.push("corpus Russian-language ratio is below the frozen requirement");
  else if (corpus.russianRatio > 1) errors.push("corpus Russian-language ratio exceeds 1");

  for (const stratum of gate.requiredStrata ?? []) {
    const fact = corpus.strata[stratum];
    if (!isRecord(fact) || !Number.isSafeInteger(fact.sourceCount) || fact.sourceCount < gate.minimumCorpus.minimumPerRequiredStratum) insufficient.push(`required stratum ${stratum} is missing or under-sampled`);
    else if (fact.status === "INSUFFICIENT") insufficient.push(`required stratum ${stratum} is insufficient`);
    else if (fact.status !== "PASS") errors.push(`required stratum ${stratum} is failing`);
  }
}

function validateMetrics(errors, insufficient, metrics, thresholds) {
  if (!isRecord(metrics)) {
    insufficient.push("release metrics are missing");
    return;
  }
  const requirements = [
    ["sceneF1At500ms", (value) => value >= thresholds.sceneF1At500msMin, `must be >= ${thresholds.sceneF1At500msMin}`],
    ["contentMacroF1", (value) => value >= thresholds.contentMacroF1Min, `must be >= ${thresholds.contentMacroF1Min}`],
    ["activeSpeakerTwoPersonF1", (value) => value >= thresholds.activeSpeakerTwoPersonF1Min, `must be >= ${thresholds.activeSpeakerTwoPersonF1Min}`],
    ["activeSpeakerHardF1", (value) => value >= thresholds.activeSpeakerHardF1Min, `must be >= ${thresholds.activeSpeakerHardF1Min}`],
    ["speakerVisibleRatio", (value) => value >= thresholds.speakerVisibleRatioMin, `must be >= ${thresholds.speakerVisibleRatioMin}`],
    ["acceptableLayoutRatio", (value) => value >= thresholds.acceptableLayoutRatioMin, `must be >= ${thresholds.acceptableLayoutRatioMin}`],
    ["forbiddenLayoutCount", (value) => value <= thresholds.forbiddenLayoutCountMax, `must be <= ${thresholds.forbiddenLayoutCountMax}`],
    ["cropOutOfBoundsCount", (value) => value <= thresholds.cropOutOfBoundsCountMax, `must be <= ${thresholds.cropOutOfBoundsCountMax}`],
    ["previewGeometryErrorPx", (value) => value <= thresholds.previewGeometryErrorPxMax, `must be <= ${thresholds.previewGeometryErrorPxMax}`],
    ["avSyncP95Ms", (value) => value <= thresholds.avSyncP95MsMax, `must be <= ${thresholds.avSyncP95MsMax}`],
    ["peakWorkerRssBytes", (value) => value <= thresholds.peakWorkerRssBytesMax, `must be <= ${thresholds.peakWorkerRssBytesMax}`],
    ["renderP95Rtf", (value) => value <= thresholds.renderP95RtfMax, `must be <= ${thresholds.renderP95RtfMax}`],
    ["weightedJainFairness", (value) => value >= thresholds.weightedJainFairnessMin, `must be >= ${thresholds.weightedJainFairnessMin}`],
    ["starvationCount", (value) => value <= thresholds.starvationCountMax, `must be <= ${thresholds.starvationCountMax}`],
    ["marketPreferredRatio", (value) => value >= thresholds.marketPreferredRatioMin, `must be >= ${thresholds.marketPreferredRatioMin}`],
    ["marketWilsonLowerBound", (value) => value > thresholds.marketWilsonLowerBoundMin, `must be > ${thresholds.marketWilsonLowerBoundMin}`],
    ["marketLosingMajorStratumCount", (value) => value <= thresholds.marketLosingMajorStratumCountMax, `must be <= ${thresholds.marketLosingMajorStratumCountMax}`],
    ["manualCorrectionRate", (value) => value <= thresholds.manualCorrectionRateMax, `must be <= ${thresholds.manualCorrectionRateMax}`],
  ];
  for (const [name, predicate, message] of requirements) {
    const value = metrics[name];
    if (!finite(value)) insufficient.push(`${name}: missing or non-finite`);
    else if (!predicate(value)) errors.push(`${name}: ${message} (actual ${value})`);
  }
}

async function main() {
  if (!evidenceDirectory || !publicKeyPath) {
    console.error("INSUFFICIENT: usage requires --evidence-dir=<dir> and --public-key=<evaluator-public.pem> (or HVE_RELEASE_EVALUATOR_PUBLIC_KEY_FILE).");
    return EXIT.INSUFFICIENT;
  }
  let thresholds;
  try {
    ({ value: thresholds } = await readJson(thresholdPath));
  } catch (error) {
    console.error(`ERROR: cannot read threshold file: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.ERROR;
  }
  if (!isRecord(thresholds) || thresholds.schemaVersion !== 1 || !isRecord(thresholds.gate)) {
    console.error("ERROR: production threshold file is malformed.");
    return EXIT.ERROR;
  }
  if (thresholds.gate.status !== "active") {
    console.error("INSUFFICIENT: production thresholds are scaffolded; a sealed release cannot be approved before corpus calibration and independent threshold freeze.");
    return EXIT.INSUFFICIENT;
  }

  const root = path.resolve(evidenceDirectory);
  let evidence;
  let publicKey;
  try {
    ({ value: evidence } = await readJson(path.join(root, "release-evidence.json")));
    publicKey = await readFile(path.resolve(publicKeyPath), "utf8");
  } catch (error) {
    console.error(`ERROR: cannot read evaluator evidence: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.ERROR;
  }
  const errors = validateEvidenceShape(evidence, thresholds);
  const insufficient = [];
  if (!errors.length && !verifyCorpusIndex(evidence, publicKey)) errors.push("evaluator signature is absent, invalid, or does not bind release evidence");

  const artifactBytes = new Map();
  for (const artifact of thresholds.gate.requiredReports ?? []) {
    const expected = evidence?.artifacts?.[artifact];
    if (!safeRelativePath(artifact) || typeof expected !== "string") {
      insufficient.push(`required release artifact ${artifact} is missing from signed evidence`);
      continue;
    }
    try {
      const bytes = await readFile(path.join(root, artifact));
      artifactBytes.set(artifact, bytes);
      if (sha256(bytes) !== expected) errors.push(`artifact hash mismatch: ${artifact}`);
    } catch {
      insufficient.push(`required release artifact is unreadable: ${artifact}`);
    }
  }
  const metricsBytes = artifactBytes.get("metrics.json");
  if (metricsBytes) {
    try {
      const metrics = JSON.parse(metricsBytes.toString("utf8"));
      if (metrics.status === "INSUFFICIENT") insufficient.push("metrics.json is INSUFFICIENT");
      else if (metrics.status !== "PASS") errors.push("metrics.json is not PASS");
      const suites = new Map(Array.isArray(metrics.suites) ? metrics.suites.map((suite) => [suite?.name, suite]) : []);
      for (const suite of thresholds.gate.requiredSuites ?? []) {
        const currentSuite = suites.get(suite);
        if (!isRecord(currentSuite)) insufficient.push(`required suite ${suite} is missing`);
        else if (currentSuite.status === "INSUFFICIENT") insufficient.push(`required suite ${suite} is INSUFFICIENT`);
        else if (currentSuite.status !== "PASS") errors.push(`required suite ${suite} is not PASS`);
      }
      if (!isRecord(metrics.aggregateMetrics)) insufficient.push("metrics.json is missing aggregateMetrics");
      else if (canonicalJson(metrics.aggregateMetrics) !== canonicalJson(evidence?.metrics)) errors.push("metrics.json aggregateMetrics do not match signed release evidence");
    } catch {
      errors.push("metrics.json is not valid JSON");
    }
  }
  const corpusBytes = artifactBytes.get("corpus-summary.json");
  if (corpusBytes) {
    try {
      const corpus = JSON.parse(corpusBytes.toString("utf8"));
      if (!isRecord(corpus)) errors.push("corpus-summary.json is not an object");
      else if (canonicalJson(corpus) !== canonicalJson(evidence?.corpus)) errors.push("corpus-summary.json does not match signed release evidence");
    } catch {
      errors.push("corpus-summary.json is not valid JSON");
    }
  }
  const environmentBytes = artifactBytes.get("environment.json");
  if (environmentBytes) {
    try {
      const environment = JSON.parse(environmentBytes.toString("utf8"));
      if (!isRecord(environment) || environment.imageDigest !== evidence?.candidate?.imageDigest || environment.gitSha !== evidence?.candidate?.gitSha) {
        errors.push("environment.json does not bind the evaluated report to the immutable candidate image and git SHA");
      } else if (!/^[a-f0-9]{64}$/.test(environment.ffmpegBuildSha256 ?? "") || !isRecord(environment.modelHashes)
        || Object.values(environment.modelHashes).some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
        errors.push("environment.json does not contain a valid FFmpeg build and model-hash provenance record");
      }
    } catch {
      errors.push("environment.json is not valid JSON");
    }
  }
  const baselineComparisonBytes = artifactBytes.get("baseline-comparison.json");
  if (baselineComparisonBytes) {
    try {
      const comparison = JSON.parse(baselineComparisonBytes.toString("utf8"));
      if (!isRecord(comparison) || comparison.baselineId !== thresholds.gate.hardwareBaseline) {
        errors.push("baseline-comparison.json is not bound to the frozen hardware baseline");
      } else if (comparison.status === "INSUFFICIENT") {
        insufficient.push("baseline-comparison.json is INSUFFICIENT");
      } else if (comparison.status !== "PASS") {
        errors.push("baseline-comparison.json is not PASS");
      }
    } catch {
      errors.push("baseline-comparison.json is not valid JSON");
    }
  }
  const failedItemsBytes = artifactBytes.get("failed-items.json");
  if (failedItemsBytes) {
    try {
      const failures = JSON.parse(failedItemsBytes.toString("utf8"));
      if (!Array.isArray(failures) || failures.length !== 0) errors.push("failed-items.json is not an empty release failure list");
    } catch {
      errors.push("failed-items.json is not valid JSON");
    }
  }

  validateCorpus(errors, insufficient, evidence?.corpus, thresholds.gate);
  validateMetrics(errors, insufficient, evidence?.metrics, thresholds);
  if (!isRecord(evidence?.baseline) || evidence.baseline.baselineId !== thresholds.gate.hardwareBaseline || evidence.baseline.comparisonStatus !== "PASS") {
    insufficient.push("approved Timeweb hardware baseline comparison is missing or not PASS");
  }
  if (errors.length) {
    console.error(`HVE production release gate failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
    errors.forEach((error) => console.error(`- ${error}`));
    return EXIT.FAIL;
  }
  if (insufficient.length) {
    console.error(`HVE production release gate is INSUFFICIENT (${insufficient.length} requirement${insufficient.length === 1 ? "" : "s"}):`);
    insufficient.forEach((issue) => console.error(`- ${issue}`));
    return EXIT.INSUFFICIENT;
  }
  console.log(`HVE production release evidence verified: ${evidence.candidate.gitSha} (${thresholds.name}).`);
  return EXIT.PASS;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(`HVE production release ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT.ERROR);
});
