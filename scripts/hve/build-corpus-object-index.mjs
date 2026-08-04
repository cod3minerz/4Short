import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { signCorpusIndex, sha256, validateAnnotationForItem } from "./corpus-index.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const has = (name) => args.includes(name);
const positional = args.find((argument) => !argument.startsWith("--"));
const manifestPath = path.resolve(option("--manifest") ?? positional ?? "verification/hve/manifests/smoke-v1.json");
const outputPath = path.resolve(option("--out") ?? `outputs/hve/corpus-index/${path.basename(manifestPath, path.extname(manifestPath))}-index.json`);
const overwrite = has("--overwrite");
const maxObjectBytes = Number(option("--max-object-bytes") ?? process.env.HVE_CORPUS_MAX_OBJECT_BYTES ?? 15 * 1024 * 1024 * 1024);
const maxAnnotationBytes = Number(option("--max-annotation-bytes") ?? process.env.HVE_CORPUS_MAX_ANNOTATION_BYTES ?? 16 * 1024 * 1024);
const env = process.env;

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}. Corpus verification must use an evaluator-only S3 credential.`);
  return value;
}

function privateObjectKey(value, field) {
  if (
    typeof value !== "string"
    || !value
    || value.startsWith("/")
    || value.includes("..")
    || value.includes(":")
    || value.includes("\\")
    || value.includes("//")
    || /[\u0000-\u001f]/.test(value)
  ) {
    throw new Error(`${field} must be a private, relative S3 object key`);
  }
  return value;
}

function uniqueObjectKeys(manifest) {
  const keys = new Set();
  const annotationKeys = new Set();
  const sourceKeys = new Set();
  for (const item of manifest.items ?? []) {
    const sourceKey = privateObjectKey(item.objectKey, `${item.itemId}.objectKey`);
    const annotationKey = privateObjectKey(item.annotationKey, `${item.itemId}.annotationKey`);
    if (sourceKeys.has(sourceKey)) throw new Error(`${item.itemId}.objectKey duplicates another corpus item`);
    if (annotationKeys.has(annotationKey)) throw new Error(`${item.itemId}.annotationKey duplicates another corpus item`);
    sourceKeys.add(sourceKey);
    annotationKeys.add(annotationKey);
    keys.add(sourceKey);
    keys.add(annotationKey);
    keys.add(privateObjectKey(item.licenseRef, `${item.itemId}.licenseRef`));
  }
  return [...keys].sort();
}

async function hashBody(body, expectedLength, captureMaxBytes = 0) {
  if (!body || typeof body[Symbol.asyncIterator] !== "function") throw new Error("S3 object body is not streamable");
  if (Number.isFinite(expectedLength) && expectedLength > maxObjectBytes) throw new Error(`Object exceeds ${maxObjectBytes} byte verifier limit`);
  if (captureMaxBytes && Number.isFinite(expectedLength) && expectedLength > captureMaxBytes) throw new Error(`Annotation exceeds ${captureMaxBytes} byte verifier limit`);
  const hash = createHash("sha256");
  let bytes = 0;
  const captured = [];
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxObjectBytes) throw new Error(`Object exceeds ${maxObjectBytes} byte verifier limit while streaming`);
    if (captureMaxBytes && bytes > captureMaxBytes) throw new Error(`Annotation exceeds ${captureMaxBytes} byte verifier limit while streaming`);
    hash.update(buffer);
    if (captureMaxBytes) captured.push(buffer);
  }
  if (Number.isFinite(expectedLength) && bytes !== expectedLength) throw new Error(`S3 object byte count changed while reading (${bytes} != ${expectedLength})`);
  return { bytes, sha256: hash.digest("hex"), ...(captureMaxBytes ? { content: Buffer.concat(captured) } : {}) };
}

let manifestBytes;
let manifest;
try {
  manifestBytes = await readFile(manifestPath);
  manifest = JSON.parse(manifestBytes.toString("utf8"));
} catch (error) {
  console.error(`ERROR: cannot read manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

if (manifest?.status !== "ready") {
  console.error("INSUFFICIENT: only a ready corpus manifest can receive a signed object index. Scaffold media must never become release evidence.");
  process.exit(2);
}
if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes <= 0 || !Number.isSafeInteger(maxAnnotationBytes) || maxAnnotationBytes <= 0) {
  console.error("ERROR: --max-object-bytes and --max-annotation-bytes must be positive safe integers");
  process.exit(3);
}

let keys;
try {
  keys = uniqueObjectKeys(manifest);
} catch (error) {
  console.error(`ERROR: malformed ready corpus manifest: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const endpoint = required("HVE_CORPUS_S3_ENDPOINT");
const bucket = required("HVE_CORPUS_S3_BUCKET");
const privateKey = required("HVE_CORPUS_INDEX_SIGNING_PRIVATE_KEY");
const client = new S3Client({
  endpoint,
  region: env.HVE_CORPUS_S3_REGION ?? "ru-1",
  forcePathStyle: env.HVE_CORPUS_S3_FORCE_PATH_STYLE !== "false",
  credentials: {
    accessKeyId: required("HVE_CORPUS_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("HVE_CORPUS_S3_SECRET_ACCESS_KEY"),
  },
});

const objects = {};
try {
  const annotationItems = new Map(manifest.items.map((item) => [item.annotationKey, item]));
  for (const key of keys) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const annotationItem = annotationItems.get(key);
    const fact = await hashBody(response.Body, response.ContentLength, annotationItem ? maxAnnotationBytes : 0);
    if (annotationItem) {
      let annotation;
      try {
        annotation = JSON.parse(fact.content.toString("utf8"));
      } catch {
        throw new Error(`${key}: annotation is not valid UTF-8 JSON`);
      }
      const annotationErrors = validateAnnotationForItem(annotation, annotationItem);
      if (annotationErrors.length) throw new Error(`${key}: annotation validation failed: ${annotationErrors.join("; ")}`);
    }
    const objectFact = { ...fact };
    delete objectFact.content;
    objects[key] = {
      ...objectFact,
      ...(typeof response.ContentType === "string" ? { contentType: response.ContentType } : {}),
    };
  }
} catch (error) {
  console.error(`ERROR: corpus object verification stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

const index = signCorpusIndex({
  schemaVersion: 1,
  kind: "hve-corpus-object-index",
  corpusVersion: manifest.corpusVersion,
  manifestSha256: sha256(manifestBytes),
  generatedAt: new Date().toISOString(),
  verifier: { id: env.HVE_CORPUS_VERIFIER_ID ?? "timeweb-release-evaluator" },
  verification: { annotationSchema: "hve-annotation-v1", annotationsVerified: true },
  objects,
}, privateKey);

try {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, { encoding: "utf8", flag: overwrite ? "w" : "wx", mode: 0o600 });
} catch (error) {
  console.error(`ERROR: cannot write signed corpus index ${outputPath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

console.log(`HVE corpus index written: ${outputPath} (${keys.length} objects, ${manifest.corpusVersion}). Do not commit it or the evaluator private key.`);
