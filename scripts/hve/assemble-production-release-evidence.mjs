import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { signCorpusIndex } from "./corpus-index.mjs";

const EXIT = { PASS: 0, FAIL: 1, INSUFFICIENT: 2, ERROR: 3 };
const args = process.argv.slice(2);
const option = (name) => args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const hasFlag = (name) => args.includes(name);
const evidenceDirectory = option("--evidence-dir");
const thresholdPath = path.resolve(option("--thresholds") ?? "verification/hve/thresholds/production-v1.json");
const candidateGitSha = option("--candidate-git-sha");
const candidateImageDigest = option("--candidate-image-digest");
const outputPath = option("--out");
const privateKeyPath = process.env.HVE_RELEASE_EVALUATOR_PRIVATE_KEY_FILE;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

async function json(file) {
  const bytes = await readFile(file);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function candidateIsValid(gitSha, imageDigest) {
  return /^[a-f0-9]{40}$/.test(gitSha ?? "") && /^sha256:[a-f0-9]{64}$/.test(imageDigest ?? "");
}

function environmentIsBound(environment, gitSha, imageDigest) {
  return isRecord(environment)
    && environment.gitSha === gitSha
    && environment.imageDigest === imageDigest
    && /^[a-f0-9]{64}$/.test(environment.ffmpegBuildSha256 ?? "")
    && isRecord(environment.modelHashes)
    && Object.values(environment.modelHashes).every((hash) => /^[a-f0-9]{64}$/.test(hash));
}

async function main() {
  if (!evidenceDirectory || !candidateIsValid(candidateGitSha, candidateImageDigest) || !privateKeyPath) {
    console.error("ERROR: usage requires --evidence-dir, --candidate-git-sha, --candidate-image-digest and HVE_RELEASE_EVALUATOR_PRIVATE_KEY_FILE.");
    return EXIT.ERROR;
  }

  let thresholds;
  try {
    ({ value: thresholds } = await json(thresholdPath));
  } catch (error) {
    console.error(`ERROR: cannot read thresholds: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.ERROR;
  }
  if (!isRecord(thresholds) || thresholds.schemaVersion !== 1 || !isRecord(thresholds.gate) || typeof thresholds.name !== "string") {
    console.error("ERROR: release thresholds are malformed.");
    return EXIT.ERROR;
  }
  if (thresholds.gate.status !== "active" && !hasFlag("--allow-scaffold")) {
    console.error("INSUFFICIENT: threshold file is scaffolded. Refuse to create release evidence without explicit --allow-scaffold dry-run intent.");
    return EXIT.INSUFFICIENT;
  }

  const root = path.resolve(evidenceDirectory);
  const artifacts = {};
  const artifactValues = new Map();
  for (const artifact of thresholds.gate.requiredReports ?? []) {
    if (!safeRelativePath(artifact)) {
      console.error(`ERROR: threshold contains an unsafe artifact name: ${artifact}`);
      return EXIT.ERROR;
    }
    try {
      const bytes = await readFile(path.join(root, artifact));
      artifacts[artifact] = sha256(bytes);
      if (["metrics.json", "corpus-summary.json", "baseline-comparison.json", "environment.json"].includes(artifact)) {
        artifactValues.set(artifact, JSON.parse(bytes.toString("utf8")));
      }
    } catch (error) {
      console.error(`INSUFFICIENT: required evaluator report is missing or invalid: ${artifact} (${error instanceof Error ? error.message : String(error)})`);
      return EXIT.INSUFFICIENT;
    }
  }

  const metrics = artifactValues.get("metrics.json");
  const corpus = artifactValues.get("corpus-summary.json");
  const baseline = artifactValues.get("baseline-comparison.json");
  const environment = artifactValues.get("environment.json");
  if (!isRecord(metrics) || !isRecord(metrics.aggregateMetrics) || !isRecord(corpus)) {
    console.error("INSUFFICIENT: metrics.json.aggregateMetrics and corpus-summary.json are required evaluator facts.");
    return EXIT.INSUFFICIENT;
  }
  if (!isRecord(baseline) || baseline.status !== "PASS" || baseline.baselineId !== thresholds.gate.hardwareBaseline) {
    console.error("INSUFFICIENT: baseline-comparison.json is not a PASS for the frozen hardware baseline.");
    return EXIT.INSUFFICIENT;
  }
  if (!environmentIsBound(environment, candidateGitSha, candidateImageDigest)) {
    console.error("FAIL: environment.json does not bind valid FFmpeg/model provenance to the immutable candidate.");
    return EXIT.FAIL;
  }

  let privateKey;
  try {
    privateKey = await readFile(path.resolve(privateKeyPath), "utf8");
  } catch (error) {
    console.error(`ERROR: evaluator private key is unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.ERROR;
  }
  const evidence = signCorpusIndex({
    schemaVersion: 1,
    kind: "hve-production-evidence",
    thresholdVersion: thresholds.name,
    candidate: { gitSha: candidateGitSha, imageDigest: candidateImageDigest },
    corpus,
    metrics: metrics.aggregateMetrics,
    baseline: { baselineId: baseline.baselineId, comparisonStatus: baseline.status },
    artifacts,
    signedAt: new Date().toISOString(),
  }, privateKey);
  const destination = path.resolve(outputPath ?? path.join(root, "release-evidence.json"));
  try {
    await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: hasFlag("--overwrite") ? "w" : "wx",
    });
  } catch (error) {
    console.error(`ERROR: cannot write signed release evidence: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.ERROR;
  }
  console.log(`HVE release evidence signed for ${candidateGitSha} at ${destination}${thresholds.gate.status === "active" ? "" : " (scaffold dry run)"}.`);
  return EXIT.PASS;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(`HVE release evidence assembly ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT.ERROR);
});
