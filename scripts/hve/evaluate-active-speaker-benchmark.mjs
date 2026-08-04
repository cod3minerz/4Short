import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { verifyCorpusIndex } from "./corpus-index.mjs";
import { evaluateActiveSpeaker } from "./active-speaker-evaluation.mjs";

/**
 * Evaluator-only HVE-G5 entrypoint. Product CI may test the pure scorer, but
 * it cannot produce a promotion report: this command requires separately
 * signed corpus labels and signed candidate outputs using the release
 * evaluator's Ed25519 key.
 */
const args = process.argv.slice(2);
const option = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const manifestPath = option("--manifest");
const objectIndexPath = option("--object-index");
const publicKeyPath = option("--public-key");
const labelsPath = option("--labels");
const predictionsPath = option("--predictions");
const outputPath = option("--out");

if (!manifestPath || !objectIndexPath || !publicKeyPath || !labelsPath || !predictionsPath || !outputPath) {
  console.error("usage: evaluate-active-speaker-benchmark.mjs --manifest=<ready.json> --object-index=<signed-index.json> --public-key=<evaluator.pem> --labels=<signed-labels.json> --predictions=<signed-predictions.json> --out=<benchmark.json>");
  process.exit(3);
}

async function readJson(name, filePath) {
  try {
    return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

let manifest;
let manifestBytes;
let objectIndex;
let labels;
let predictions;
let publicKey;
try {
  [manifestBytes, objectIndex, labels, predictions, publicKey] = await Promise.all([
    readFile(path.resolve(manifestPath)),
    readJson("object index", objectIndexPath),
    readJson("labels", labelsPath),
    readJson("predictions", predictionsPath),
    readFile(path.resolve(publicKeyPath), "utf8"),
  ]);
  manifest = JSON.parse(manifestBytes.toString("utf8"));
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

if (!verifyCorpusIndex(objectIndex, publicKey)) {
  console.error("ERROR: signed corpus index is invalid for the supplied evaluator key");
  process.exit(1);
}
if (objectIndex.manifestSha256 !== createHash("sha256").update(manifestBytes).digest("hex")) {
  console.error("ERROR: signed corpus index does not bind the exact manifest bytes");
  process.exit(1);
}
if (!verifyCorpusIndex(labels, publicKey)) {
  console.error("ERROR: labels bundle is unsigned or was not signed by the release evaluator");
  process.exit(1);
}
if (!verifyCorpusIndex(predictions, publicKey)) {
  console.error("ERROR: predictions bundle is unsigned or was not signed by the release evaluator");
  process.exit(1);
}

let report;
try {
  report = evaluateActiveSpeaker({ manifest, objectIndex, labels, predictions });
} catch (error) {
  console.error(`ERROR: active-speaker evaluation cannot use this evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

try {
  const absoluteOutput = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log(`HVE-G5 active-speaker evaluation written: ${absoluteOutput} (${report.evaluation.itemsEvaluated} items, ${report.evaluation.turnsEvaluated} turns).`);
} catch (error) {
  console.error(`ERROR: cannot write active-speaker benchmark report: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}
