import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { verifyCorpusIndex } from "./corpus-index.mjs";

const manifestPath = path.resolve(process.argv[2] ?? "verification/hve/manifests/smoke-v1.json");
// A corpus manifest has two deliberately different checks:
//
//   1. `--manifest-lint` validates a checked-in scaffold as a *schema fixture*.
//   2. The default verifies a ready corpus and its independently signed objects.
//
// Keep those modes impossible to confuse. In particular, a successful lint of
// synthetic placeholder hashes must never be usable as an integrity, quality,
// capability-promotion, or release approval signal.
const manifestLintOnly = process.argv.includes("--manifest-lint");
const deprecatedAllowScaffold = process.argv.includes("--allow-scaffold");
const objectIndexArgument = process.argv.find((argument) => argument.startsWith("--object-index="));
const objectIndexPath = objectIndexArgument?.slice("--object-index=".length) ?? process.env.HVE_CORPUS_OBJECT_INDEX;
const publicKeyArgument = process.argv.find((argument) => argument.startsWith("--public-key="));
const publicKeyPath = publicKeyArgument?.slice("--public-key=".length) ?? process.env.HVE_CORPUS_INDEX_PUBLIC_KEY_FILE;
const errors = [];
const insufficiencies = [];
const allowedTagPrefixes = new Set(["content", "faces", "speech", "geometry", "codec", "quality", "failure"]);

function fail(location, message) {
  errors.push(`${location}: ${message}`);
}

function insufficient(location, message) {
  insufficiencies.push(`${location}: ${message}`);
}

if (deprecatedAllowScaffold) {
  fail("--allow-scaffold", "is no longer accepted; use --manifest-lint for schema-only scaffold checks");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.has(key));
}

function validPrivateObjectKey(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("..")
    && !value.includes("\\")
    && !value.includes(":")
    && !value.includes("//")
    && !/[\u0000-\u001f]/.test(value);
}

function validDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateRange(value, location, durationUs) {
  if (!isRecord(value)) return fail(location, "must be an object");
  if (!Number.isSafeInteger(value.startUs) || value.startUs < 0) fail(`${location}.startUs`, "must be a non-negative safe integer");
  if (!Number.isSafeInteger(value.endUs) || value.endUs <= 0) fail(`${location}.endUs`, "must be a positive safe integer");
  if (Number.isSafeInteger(value.startUs) && Number.isSafeInteger(value.endUs) && value.endUs <= value.startUs) {
    fail(location, "must be a non-empty half-open range");
  }
  if (Number.isSafeInteger(value.endUs) && Number.isSafeInteger(durationUs) && value.endUs > durationUs) {
    fail(location, "exceeds source duration");
  }
}

let manifest;
let manifestBytes;
try {
  manifestBytes = await readFile(manifestPath);
  manifest = JSON.parse(manifestBytes.toString("utf8"));
} catch (error) {
  console.error(`Cannot read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!isRecord(manifest)) {
  fail("manifest", "must be an object");
  // Continue through the same validation path with an empty object so malformed
  // JSON can only produce a controlled schema failure, never an evaluator
  // crash that could be mistaken for missing/waivable evidence.
  manifest = {};
}
const manifestKeys = new Set(["schemaVersion", "corpusVersion", "split", "status", "createdAt", "items"]);
if (!hasOnlyKeys(manifest, manifestKeys)) fail("manifest", "contains unknown top-level fields");
if (manifest.schemaVersion !== 1) fail("schemaVersion", "must equal 1");
if (typeof manifest.corpusVersion !== "string" || !/^[a-z0-9][a-z0-9._-]+$/i.test(manifest.corpusVersion)) {
  fail("corpusVersion", "must be a stable identifier");
}
if (!new Set(["smoke", "development", "holdout", "stress"]).has(manifest.split)) fail("split", "is unsupported");
if (!new Set(["scaffold", "ready"]).has(manifest.status)) fail("status", "must be scaffold or ready");
if (!validDateTime(manifest.createdAt)) fail("createdAt", "must be an ISO-8601 date-time");
if (manifest.status !== "ready" && !manifestLintOnly) insufficient("status", "is not ready; strict verification cannot pass a scaffold corpus");
if (manifest.status === "ready" && manifestLintOnly) {
  fail("--manifest-lint", "cannot be used for a ready corpus; use signed object verification instead");
}
if (!Array.isArray(manifest.items) || manifest.items.length === 0) fail("items", "must contain at least one item");

const ids = new Set();
const sourceKeys = new Set();
const annotationKeys = new Set();
let annotatedRangeCount = 0;
for (const [index, item] of (Array.isArray(manifest.items) ? manifest.items : []).entries()) {
  const location = `items[${index}]`;
  if (!isRecord(item)) {
    fail(location, "must be an object");
    continue;
  }
  if (typeof item.itemId !== "string" || item.itemId.length < 3) fail(`${location}.itemId`, "must be a stable ID");
  else if (ids.has(item.itemId)) fail(`${location}.itemId`, "is duplicated");
  else ids.add(item.itemId);
  const itemKeys = new Set([
    "itemId", "objectKey", "sha256", "objectBytes", "annotationKey", "annotationSha256",
    "licenseRef", "licenseArtifactSha256", "durationUs", "tags", "evaluationRanges",
  ]);
  if (!hasOnlyKeys(item, itemKeys)) fail(location, "contains unknown fields");
  if (!validPrivateObjectKey(item.objectKey)) {
    fail(`${location}.objectKey`, "must be a private relative object key");
  } else if (sourceKeys.has(item.objectKey)) {
    fail(`${location}.objectKey`, "must not be reused by multiple corpus items");
  } else {
    sourceKeys.add(item.objectKey);
  }
  if (!validPrivateObjectKey(item.annotationKey)) {
    fail(`${location}.annotationKey`, "must be a private relative object key");
  } else if (annotationKeys.has(item.annotationKey)) {
    fail(`${location}.annotationKey`, "must not be reused by multiple corpus items");
  } else {
    annotationKeys.add(item.annotationKey);
  }
  if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) fail(`${location}.sha256`, "must be lowercase SHA-256");
  else if (/^(.)\1{63}$/.test(item.sha256) && !manifestLintOnly) insufficient(`${location}.sha256`, "is a placeholder hash");
  if (!Number.isSafeInteger(item.objectBytes) || item.objectBytes < 0) fail(`${location}.objectBytes`, "must be a non-negative expected object size");
  else if (item.objectBytes === 0 && !manifestLintOnly) insufficient(`${location}.objectBytes`, "has no verified expected object size");
  for (const field of ["annotationSha256", "licenseArtifactSha256"]) {
    if (typeof item[field] !== "string" || !/^[a-f0-9]{64}$/.test(item[field])) fail(`${location}.${field}`, "must be lowercase SHA-256");
    else if (/^(.)\1{63}$/.test(item[field]) && !manifestLintOnly) insufficient(`${location}.${field}`, "is a placeholder hash");
  }
  if (typeof item.licenseRef !== "string" || item.licenseRef.length < 3) fail(`${location}.licenseRef`, "is required");
  if (!Number.isSafeInteger(item.durationUs) || item.durationUs <= 0) fail(`${location}.durationUs`, "must be a positive safe integer");
  if (!Array.isArray(item.tags) || item.tags.length === 0 || item.tags.some((tag) => typeof tag !== "string" || !tag)) {
    fail(`${location}.tags`, "must contain non-empty strings");
  } else if (item.tags.some((tag) => !allowedTagPrefixes.has(tag.split("/", 1)[0]) || !tag.includes("/"))) {
    fail(`${location}.tags`, "contains a tag outside the versioned taxonomy");
  }
  if (!Array.isArray(item.evaluationRanges) || item.evaluationRanges.length === 0) fail(`${location}.evaluationRanges`, "must not be empty");
  else {
    annotatedRangeCount += item.evaluationRanges.length;
    item.evaluationRanges.forEach((range, rangeIndex) => validateRange(range, `${location}.evaluationRanges[${rangeIndex}]`, item.durationUs));
    for (let rangeIndex = 1; rangeIndex < item.evaluationRanges.length; rangeIndex += 1) {
      const previous = item.evaluationRanges[rangeIndex - 1];
      const current = item.evaluationRanges[rangeIndex];
      if (isRecord(previous) && isRecord(current) && Number.isSafeInteger(previous.startUs) && Number.isSafeInteger(current.startUs)) {
        if (current.startUs < previous.startUs || current.startUs < previous.endUs) {
          fail(`${location}.evaluationRanges[${rangeIndex}]`, "must be sorted and non-overlapping");
        }
      }
    }
  }
}

const minimumBySplit = {
  smoke: { items: 24, ranges: 60 },
  development: { items: 100, ranges: 800 },
  holdout: { items: 50, ranges: 400 },
  stress: { items: 30, ranges: 300 },
};

if (manifest.status === "ready" && minimumBySplit[manifest.split]) {
  const minimum = minimumBySplit[manifest.split];
  if (manifest.items.length < minimum.items) fail("items", `ready ${manifest.split} split requires at least ${minimum.items} items`);
  if (annotatedRangeCount < minimum.ranges) fail("items[].evaluationRanges", `ready ${manifest.split} split requires at least ${minimum.ranges} ranges`);
}

if (errors.length) {
  console.error(`HVE corpus manifest is invalid (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

if (insufficiencies.length) {
  console.error(`HVE corpus evidence is insufficient (${insufficiencies.length} issue${insufficiencies.length === 1 ? "" : "s"}):`);
  for (const issue of insufficiencies) console.error(`- ${issue}`);
  process.exit(2);
}

if (manifest.status === "scaffold") {
  // This branch can only be reached with an explicit --manifest-lint flag;
  // the default path above exits 2 for every scaffold corpus.
  console.log(`HVE MANIFEST LINT ONLY: ${manifest.corpusVersion} (${manifest.items.length} scaffold items). This is not corpus integrity, a quality benchmark, a capability pass, or release approval.`);
} else {
  if (!objectIndexPath) {
    console.error("INSUFFICIENT: manifest is structurally ready, but source/annotation/license objects were not independently read and hashed. Provide --object-index=<signed-index.json> or HVE_CORPUS_OBJECT_INDEX.");
    process.exit(2);
  }

  let objectIndex;
  try {
    objectIndex = JSON.parse(await readFile(path.resolve(objectIndexPath), "utf8"));
  } catch (error) {
    console.error(`ERROR: cannot read object index ${objectIndexPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(3);
  }

  const indexObjects = objectIndex?.objects;
  if (!isRecord(indexObjects)) {
    console.error("ERROR: object index must contain an objects map produced by the independent S3 verifier");
    process.exit(3);
  }

  const expectedManifestHash = createHash("sha256").update(manifestBytes).digest("hex");
  if (
    objectIndex.schemaVersion !== 1
    || objectIndex.kind !== "hve-corpus-object-index"
    || objectIndex.corpusVersion !== manifest.corpusVersion
    || objectIndex.manifestSha256 !== expectedManifestHash
    || !isRecord(objectIndex.verifier)
    || typeof objectIndex.verifier.id !== "string"
    || !isRecord(objectIndex.verification)
    || objectIndex.verification.annotationSchema !== "hve-annotation-v1"
    || objectIndex.verification.annotationsVerified !== true
  ) {
    console.error("HVE corpus object verification failed: index does not bind the exact ready manifest, evaluator identity and verified annotation schema.");
    process.exit(1);
  }
  if (!publicKeyPath) {
    console.error("INSUFFICIENT: an object index was supplied, but no evaluator public key is configured. Set HVE_CORPUS_INDEX_PUBLIC_KEY_FILE or --public-key=<pem-file>.");
    process.exit(2);
  }
  let publicKey;
  try {
    publicKey = await readFile(path.resolve(publicKeyPath), "utf8");
  } catch (error) {
    console.error(`ERROR: cannot read evaluator public key ${publicKeyPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(3);
  }
  if (!verifyCorpusIndex(objectIndex, publicKey)) {
    console.error("HVE corpus object verification failed: evaluator signature is absent, invalid, or does not cover the index bytes.");
    process.exit(1);
  }

  const verificationErrors = [];
  const verifyHash = (key, expectedHash, expectedBytes) => {
    const actual = indexObjects[key];
    if (!isRecord(actual)) return verificationErrors.push(`${key}: missing from signed object index`);
    if (actual.sha256 !== expectedHash) verificationErrors.push(`${key}: SHA-256 mismatch`);
    if (expectedBytes !== undefined && actual.bytes !== expectedBytes) verificationErrors.push(`${key}: byte-size mismatch`);
  };

  for (const item of manifest.items) {
    verifyHash(item.objectKey, item.sha256, item.objectBytes);
    verifyHash(item.annotationKey, item.annotationSha256);
    verifyHash(item.licenseRef, item.licenseArtifactSha256);
  }

  if (verificationErrors.length) {
    console.error(`HVE corpus object verification failed (${verificationErrors.length} issues):`);
    verificationErrors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  console.log(`HVE corpus objects verified: ${manifest.corpusVersion} (${manifest.items.length} items, ${manifest.split}). This is corpus integrity only, not a quality/release PASS.`);
}
