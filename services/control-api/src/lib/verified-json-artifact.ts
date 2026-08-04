import { createHash } from "node:crypto";

/**
 * The byte-level trust boundary for small planner artifacts. It is intentionally
 * independent from S3 client configuration so integrity rules can be verified
 * without credentials or a live object store.
 */
export function decodeVerifiedJsonArtifact(
  bytes: Uint8Array,
  input: { sha256: string; maxBytes?: number },
): unknown {
  const maxBytes = input.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("S3_JSON_ARTIFACT_INVALID_LIMIT");
  if (bytes.byteLength > maxBytes) throw new Error("S3_JSON_ARTIFACT_TOO_LARGE");
  const expectedHash = input.sha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("S3_JSON_ARTIFACT_INVALID_HASH");
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expectedHash) throw new Error("S3_JSON_ARTIFACT_HASH_MISMATCH");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("S3_JSON_ARTIFACT_INVALID_JSON");
  }
}
