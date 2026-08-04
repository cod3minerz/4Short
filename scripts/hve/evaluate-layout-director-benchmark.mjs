import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { signCorpusIndex, verifyCorpusIndex } from "./corpus-index.mjs";
import { evaluateLayoutDirector } from "./layout-director-evaluation.mjs";

/**
 * Evaluator-only HVE-G6 entrypoint. Product CI can test the pure scorer, but
 * only the evaluator can combine a signed corpus index and signed candidate
 * outputs into a benchmark report.
 */
const args = process.argv.slice(2);
const option = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const manifestPath = option("--manifest");
const objectIndexPath = option("--object-index");
const publicKeyPath = option("--public-key");
const privateKeyPath = option("--private-key") ?? process.env.HVE_CORPUS_INDEX_SIGNING_PRIVATE_KEY_FILE;
const labelsPath = option("--labels");
const predictionsPath = option("--predictions");
const outputPath = option("--out");

if (!manifestPath || !objectIndexPath || !publicKeyPath || !privateKeyPath || !labelsPath || !predictionsPath || !outputPath) {
  console.error("usage: evaluate-layout-director-benchmark.mjs --manifest=<ready.json> --object-index=<signed-index.json> --public-key=<evaluator-public.pem> --private-key=<evaluator-private.pem> --labels=<signed-labels.json> --predictions=<signed-predictions.json> --out=<signed-benchmark.json>");
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
let privateKey;
try {
  [manifestBytes, objectIndex, labels, predictions, publicKey, privateKey] = await Promise.all([
    readFile(path.resolve(manifestPath)),
    readJson("object index", objectIndexPath),
    readJson("labels", labelsPath),
    readJson("predictions", predictionsPath),
    readFile(path.resolve(publicKeyPath), "utf8"),
    readFile(path.resolve(privateKeyPath), "utf8"),
  ]);
  manifest = JSON.parse(manifestBytes.toString("utf8"));
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

for (const [name, input] of [["signed corpus index", objectIndex], ["labels bundle", labels], ["predictions bundle", predictions]]) {
  if (!verifyCorpusIndex(input, publicKey)) {
    console.error(`ERROR: ${name} is unsigned or was not signed by the release evaluator`);
    process.exit(1);
  }
}
if (objectIndex.manifestSha256 !== createHash("sha256").update(manifestBytes).digest("hex")) {
  console.error("ERROR: signed corpus index does not bind exact manifest bytes");
  process.exit(1);
}

let unsignedReport;
try {
  unsignedReport = evaluateLayoutDirector({ manifest, objectIndex, labels, predictions });
} catch (error) {
  console.error(`ERROR: layout-director evaluation cannot use this evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let report;
try {
  report = signCorpusIndex(unsignedReport, privateKey);
} catch (error) {
  console.error(`ERROR: cannot sign layout-director benchmark report: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

try {
  const target = path.resolve(outputPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log(`HVE-G6 layout-director evaluation written: ${target} (${report.evaluation.itemsEvaluated} items, ${report.evaluation.rangesEvaluated} ranges).`);
} catch (error) {
  console.error(`ERROR: cannot write layout-director benchmark report: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}
