import { readFile, writeFile } from "node:fs/promises";

import {
  canonicalJson,
  sha256,
  signCorpusIndex,
  verifyCorpusIndex,
} from "./corpus-index.mjs";

const EXIT = { PASS: 0, FAIL: 1, INSUFFICIENT: 2, ERROR: 3 };
const REQUIRED_SAMPLE_COUNT = 3;
const EXPECTED_FIXTURE = {
  sourceDurationSeconds: 60,
  sourceResolution: "1280x720",
  outputResolution: "1080x1920",
  fps: 30,
  encoder: "libx264/veryfast",
  audio: "aac/128k",
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function exactFixture(value) {
  if (!isRecord(value)) return false;
  return Object.entries(EXPECTED_FIXTURE).every(([key, expected]) => value[key] === expected);
}

function sampleEnvironment(report) {
  const environment = report?.environment;
  if (!isRecord(environment)) return null;
  const requiredString = ["cpuModel", "kernel", "python", "ffmpeg", "ffmpegBuildSha256", "imageDigest"];
  if (requiredString.some((key) => typeof environment[key] !== "string" || !environment[key])) return null;
  if (!/^sha256:[a-f0-9]{64}$/.test(environment.imageDigest)) return null;
  if (!/^[a-f0-9]{64}$/.test(environment.ffmpegBuildSha256)) return null;
  const requiredInteger = ["logicalCpu", "effectiveMemoryBytes", "scratchTotalBytes", "scratchFreeBytesBefore", "scratchFreeBytesAfter"];
  if (requiredInteger.some((key) => !Number.isSafeInteger(environment[key]) || environment[key] <= 0)) return null;
  const requiredFinite = ["cgroupCpuLimitCores", "effectiveCpuCores"];
  if (requiredFinite.some((key) => !finite(environment[key]) || environment[key] <= 0)) return null;
  if (environment.cgroupCpuLimitCores > environment.logicalCpu || environment.effectiveCpuCores !== environment.cgroupCpuLimitCores) return null;
  return environment;
}

export function validateBenchmarkSample(report) {
  const errors = [];
  if (!isRecord(report) || report.schemaVersion !== 1 || report.kind !== "hve-worker-benchmark" || report.status !== "PASS") {
    return ["report is not a successful hve-worker-benchmark v1 sample"];
  }
  const environment = sampleEnvironment(report);
  if (!environment) errors.push("environment is incomplete, unsigned-image, or malformed");
  if (!Number.isInteger(report.benchmark?.threads) || report.benchmark.threads < 1 || report.benchmark.threads > 8) {
    errors.push("benchmark.threads is missing or invalid");
  }
  const result = report.result;
  if (!isRecord(result) || !exactFixture(result.fixture)) errors.push("fixture is not the fixed 60-second production fixture");
  const render = result?.render;
  for (const key of ["subprocessWallSeconds", "subprocessPeakRssBytes", "realtimeFactor"]) {
    if (!finite(render?.[key]) || render[key] <= 0) errors.push(`render.${key} is missing or invalid`);
  }
  if (finite(render?.realtimeFactor) && finite(render?.subprocessWallSeconds)) {
    const recomputed = Number((render.subprocessWallSeconds / 60).toFixed(4));
    if (Math.abs(recomputed - render.realtimeFactor) > 0.0001) errors.push("render realtime factor is inconsistent with the fixture duration");
  }
  return errors;
}

function compatibleEnvironment(left, right) {
  return left.cpuModel === right.cpuModel
    && left.logicalCpu === right.logicalCpu
    && left.cgroupCpuLimitCores === right.cgroupCpuLimitCores
    && left.effectiveCpuCores === right.effectiveCpuCores
    && left.effectiveMemoryBytes === right.effectiveMemoryBytes
    && left.scratchTotalBytes === right.scratchTotalBytes
    && left.kernel === right.kernel
    && left.python === right.python
    && left.ffmpegBuildSha256 === right.ffmpegBuildSha256
    && left.imageDigest === right.imageDigest;
}

/**
 * @param {{
 *   baselineId: string,
 *   reports: Array<{ report: any, rawBytes: Buffer }>,
 *   privateKey: string | Buffer,
 *   approval?: { reference: string, reviewedBy: string } | null,
 *   corpusVersion?: string,
 * }} input
 */
export function buildBaseline({ baselineId, reports, privateKey, approval = null, corpusVersion = "synthetic-ffmpeg-v1" }) {
  if (reports.length < REQUIRED_SAMPLE_COUNT) throw new Error(`requires at least ${REQUIRED_SAMPLE_COUNT} benchmark reports`);
  const parsed = reports.map(({ report, rawBytes }) => {
    const errors = validateBenchmarkSample(report);
    if (errors.length) throw new Error(errors.join("; "));
    return { report, rawBytes, environment: sampleEnvironment(report) };
  });
  const reference = parsed[0].environment;
  if (parsed.some((sample) => !compatibleEnvironment(reference, sample.environment))) {
    throw new Error("all baseline samples must have identical CPU/cgroup/scratch/image/FFmpeg environment");
  }
  const threads = parsed[0].report.benchmark.threads;
  if (parsed.some((sample) => sample.report.benchmark.threads !== threads)) {
    throw new Error("all baseline samples must use the same FFmpeg thread count");
  }
  const rtfs = parsed.map(({ report }) => report.result.render.realtimeFactor);
  const rss = parsed.map(({ report }) => report.result.render.subprocessPeakRssBytes);
  const scratchFree = parsed.map(({ report }) => Math.min(report.environment.scratchFreeBytesBefore, report.environment.scratchFreeBytesAfter));
  const unsigned = {
    schemaVersion: 1,
    kind: "hve-worker-hardware-baseline",
    baselineId,
    status: approval ? "approved" : "candidate",
    hardware: {
      cpuModel: reference.cpuModel,
      logicalCpu: reference.logicalCpu,
      cpuLimitCores: reference.cgroupCpuLimitCores,
      ramBytes: reference.effectiveMemoryBytes,
      scratchBytes: reference.scratchTotalBytes,
      region: "operator-declared",
    },
    software: {
      imageDigest: reference.imageDigest,
      kernel: reference.kernel,
      ffmpeg: reference.ffmpeg,
      ffmpegBuildSha256: reference.ffmpegBuildSha256,
      python: reference.python,
      modelHashes: {},
    },
    corpusVersion,
    benchmarkProfile: {
      fixture: EXPECTED_FIXTURE,
      threads,
      sampleCount: parsed.length,
      sampleHashes: parsed.map(({ rawBytes }) => sha256(rawBytes)),
    },
    metrics: {
      renderRtfP50: Number(median(rtfs).toFixed(4)),
      renderRtfP95: Number(percentile(rtfs, 0.95).toFixed(4)),
      renderPeakRssBytesMax: Math.max(...rss),
      scratchFreeBytesMin: Math.min(...scratchFree),
    },
    ...(approval ? { approval } : {}),
    signedAt: new Date().toISOString(),
  };
  return signCorpusIndex(unsigned, privateKey);
}

export function compareBenchmarkToBaseline({ report, baseline, publicKey }) {
  const errors = validateBenchmarkSample(report);
  if (errors.length) return { status: "FAIL", errors, comparison: null };
  if (!isRecord(baseline) || baseline.kind !== "hve-worker-hardware-baseline") {
    return { status: "INSUFFICIENT", errors: ["baseline is absent or has an unknown kind"], comparison: null };
  }
  if (!verifyCorpusIndex(baseline, publicKey)) {
    return { status: "FAIL", errors: ["baseline signature is absent, invalid, or does not cover its facts"], comparison: null };
  }
  if (baseline.status !== "approved" || !isRecord(baseline.approval)) {
    return { status: "INSUFFICIENT", errors: ["baseline is a candidate and has not received independent approval"], comparison: null };
  }
  const fixture = report.result.fixture;
  if (canonicalJson(fixture) !== canonicalJson(baseline.benchmarkProfile?.fixture)) {
    return { status: "INSUFFICIENT", errors: ["candidate fixture does not match the approved baseline fixture"], comparison: null };
  }
  if (report.benchmark?.threads !== baseline.benchmarkProfile?.threads) {
    return { status: "INSUFFICIENT", errors: ["candidate FFmpeg thread count does not match the approved baseline"], comparison: null };
  }
  const environment = sampleEnvironment(report);
  const expected = baseline.hardware;
  const software = baseline.software;
  if (!environment || environment.cpuModel !== expected.cpuModel || environment.logicalCpu !== expected.logicalCpu
    || environment.cgroupCpuLimitCores !== expected.cpuLimitCores
    || environment.effectiveMemoryBytes !== expected.ramBytes || environment.scratchTotalBytes !== expected.scratchBytes
    || environment.ffmpegBuildSha256 !== software.ffmpegBuildSha256 || environment.imageDigest !== software.imageDigest) {
    return { status: "INSUFFICIENT", errors: ["candidate worker/image does not match the approved baseline environment"], comparison: null };
  }
  const render = report.result.render;
  const actualScratch = Math.min(environment.scratchFreeBytesBefore, environment.scratchFreeBytesAfter);
  const comparison = {
    rtfRatio: Number((render.realtimeFactor / baseline.metrics.renderRtfP95).toFixed(4)),
    rssRatio: Number((render.subprocessPeakRssBytes / baseline.metrics.renderPeakRssBytesMax).toFixed(4)),
    scratchRatio: Number((actualScratch / baseline.metrics.scratchFreeBytesMin).toFixed(4)),
  };
  const failures = [];
  if (comparison.rtfRatio > 1.1) failures.push("render RTF regressed by more than 10% from approved p95");
  if (comparison.rssRatio > 1.05) failures.push("peak RSS regressed by more than 5% from approved maximum");
  if (comparison.scratchRatio < 0.9) failures.push("free scratch dropped by more than 10% from approved minimum");
  return { status: failures.length ? "FAIL" : "PASS", errors: failures, comparison };
}

function arg(name) {
  const token = process.argv.find((value) => value.startsWith(`--${name}=`));
  return token?.slice(name.length + 3) ?? null;
}

async function readJson(file) {
  const rawBytes = await readFile(file);
  return { rawBytes, report: JSON.parse(rawBytes.toString("utf8")) };
}

async function main() {
  const command = process.argv[2];
  if (command === "build") {
    const baselineId = arg("baseline-id");
    const output = arg("output");
    const inputs = process.argv.filter((value) => value.startsWith("--sample=")).map((value) => value.slice(9));
    const privateKeyPath = process.env.HVE_HARDWARE_BASELINE_PRIVATE_KEY_FILE;
    if (!baselineId || !output || !privateKeyPath || inputs.length < REQUIRED_SAMPLE_COUNT) {
      throw new Error("build requires --baseline-id, --output, three --sample paths, and HVE_HARDWARE_BASELINE_PRIVATE_KEY_FILE");
    }
    const approvalReference = arg("approval-reference");
    const reviewedBy = arg("reviewed-by");
    if ((approvalReference || reviewedBy) && (!approvalReference || !reviewedBy)) throw new Error("approval requires both --approval-reference and --reviewed-by");
    const reports = await Promise.all(inputs.map(readJson));
    const privateKey = await readFile(privateKeyPath, "utf8");
    const baseline = buildBaseline({
      baselineId,
      reports,
      privateKey,
      approval: approvalReference ? { reference: approvalReference, reviewedBy } : null,
    });
    await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(`HVE hardware baseline ${baseline.status}: ${output}`);
    return EXIT.PASS;
  }
  if (command === "compare") {
    const samplePath = arg("sample");
    const baselinePath = arg("baseline");
    const publicKeyPath = process.env.HVE_HARDWARE_BASELINE_PUBLIC_KEY_FILE;
    if (!samplePath || !baselinePath || !publicKeyPath) throw new Error("compare requires --sample, --baseline, and HVE_HARDWARE_BASELINE_PUBLIC_KEY_FILE");
    const [{ rawBytes, report }, baselineText, publicKey] = await Promise.all([
      readJson(samplePath), readFile(baselinePath, "utf8"), readFile(publicKeyPath, "utf8"),
    ]);
    const result = compareBenchmarkToBaseline({ report, rawBytes, baseline: JSON.parse(baselineText), publicKey });
    console.log(JSON.stringify({ kind: "hve-worker-baseline-comparison", ...result }, null, 2));
    return EXIT[result.status];
  }
  throw new Error("usage: worker-benchmark-baseline.mjs build|compare ...");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(`HVE worker baseline ERROR: ${error.message}`);
    process.exit(EXIT.ERROR);
  });
}
