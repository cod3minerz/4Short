import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assessBrowserMediaAccess, verifySignedBrowserMediaAccess } from "../../services/control-api/src/lib/browser-media-contract.js";
import { decodeVerifiedJsonArtifact } from "../../services/control-api/src/lib/verified-json-artifact.js";

const bytesFor = (value: string) => new TextEncoder().encode(value);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("verified JSON artifact parser accepts only the exact persisted bytes", () => {
  const bytes = bytesFor('{"sourceId":"source-1","regions":[]}');
  assert.deepEqual(
    decodeVerifiedJsonArtifact(bytes, { sha256: sha256(bytes), maxBytes: 1024 }),
    { sourceId: "source-1", regions: [] },
  );
});

test("verified JSON artifact parser rejects invalid metadata, corruption and invalid JSON", () => {
  const bytes = bytesFor('{"ok":true}');
  assert.throws(() => decodeVerifiedJsonArtifact(bytes, { sha256: "not-a-hash" }), /S3_JSON_ARTIFACT_INVALID_HASH/);
  assert.throws(() => decodeVerifiedJsonArtifact(bytes, { sha256: sha256(bytes), maxBytes: 1 }), /S3_JSON_ARTIFACT_TOO_LARGE/);
  assert.throws(() => decodeVerifiedJsonArtifact(bytes, { sha256: "a".repeat(64) }), /S3_JSON_ARTIFACT_HASH_MISMATCH/);

  const invalid = bytesFor("not json");
  assert.throws(() => decodeVerifiedJsonArtifact(invalid, { sha256: sha256(invalid) }), /S3_JSON_ARTIFACT_INVALID_JSON/);
});

test("browser composition preview requires CORS, Range semantics and a video response", () => {
  const valid = {
    status: 206,
    contentType: "video/mp4",
    acceptRanges: "bytes",
    contentRange: "bytes 0-0/12345",
    accessControlAllowOrigin: "https://app.4short.ru",
    requestedOrigin: "https://app.4short.ru",
  };
  assert.deepEqual(assessBrowserMediaAccess(valid), { status: "ready" });
  assert.deepEqual(assessBrowserMediaAccess({ ...valid, accessControlAllowOrigin: null }), {
    status: "unavailable", reason: "cors_not_allowed",
  });
  assert.deepEqual(assessBrowserMediaAccess({ ...valid, acceptRanges: null }), {
    status: "unavailable", reason: "range_not_supported",
  });
  assert.deepEqual(assessBrowserMediaAccess({ ...valid, status: 200 }), {
    status: "unavailable", reason: "unexpected_media_response",
  });
});

test("browser media probe sends only an origin-bound one-byte range request", async () => {
  let request: RequestInit | undefined;
  const result = await verifySignedBrowserMediaAccess({
    url: "https://storage.example/private.mp4?signature=redacted",
    origin: "https://app.4short.ru",
    fetchImpl: async (_url, init) => {
      request = init;
      return new Response(null, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "accept-ranges": "bytes",
          "content-range": "bytes 0-0/10",
          "access-control-allow-origin": "https://app.4short.ru",
        },
      });
    },
  });
  assert.deepEqual(result, { status: "ready" });
  assert.equal(request?.method, "GET");
  assert.equal(new Headers(request?.headers).get("Origin"), "https://app.4short.ru");
  assert.equal(new Headers(request?.headers).get("Range"), "bytes=0-0");
});
