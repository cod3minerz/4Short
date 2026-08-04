import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { signCorpusIndex } from "./corpus-index.mjs";

/**
 * Signs a compact evaluator-owned HVE evidence bundle. It deliberately does
 * not accept arbitrary kinds: corpus labels and candidate predictions have
 * different ownership from product/runtime JSON and must never be signed by a
 * deploy key or a normal worker.
 */
const args = process.argv.slice(2);
const option = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const inputPath = option("--in");
const outputPath = option("--out");
const privateKeyPath = option("--private-key") ?? process.env.HVE_CORPUS_INDEX_SIGNING_PRIVATE_KEY_FILE;

if (!inputPath || !outputPath || !privateKeyPath) {
  console.error("usage: sign-evaluator-bundle.mjs --in=<unsigned.json> --out=<signed.json> --private-key=<evaluator-ed25519.pem>");
  process.exit(3);
}

let bundle;
let privateKey;
try {
  bundle = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
  privateKey = await readFile(path.resolve(privateKeyPath), "utf8");
} catch (error) {
  console.error(`ERROR: cannot read evaluator bundle/key: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)
  || bundle.schemaVersion !== 1
  || ![
    "hve-active-speaker-labels-v1",
    "hve-active-speaker-predictions-v1",
    "hve-layout-director-labels-v1",
    "hve-layout-director-predictions-v1",
  ].includes(bundle.kind)
  || "signature" in bundle) {
  console.error("ERROR: only unsigned evaluator-owned HVE-G5/G6 labels or predictions v1 bundles can be signed");
  process.exit(1);
}

const signed = signCorpusIndex(bundle, privateKey);
try {
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(path.resolve(outputPath), `${JSON.stringify(signed, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
} catch (error) {
  console.error(`ERROR: cannot write signed evaluator bundle: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}
console.log(`Signed ${bundle.kind}: ${path.resolve(outputPath)}. Keep it evaluator-only; never commit private corpus labels or the key.`);
