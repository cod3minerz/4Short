# Timeweb S3: private editor preview

HVE keeps source video private. The browser receives only a short-lived signed
`GET` URL; it never receives S3 credentials or an object key. For the
composition Canvas to draw that video, the bucket must also pass the media
contract checked by `editor-manifest`:

- `GET` from the exact dashboard `Origin` returns `Access-Control-Allow-Origin`
  for that origin (or `*` when no credentials are used);
- a `Range: bytes=0-0` request returns `206`, `Accept-Ranges: bytes` and
  `Content-Range`;
- the object has the real `video/mp4` content type;
- URLs remain private and short-lived — do **not** make the raw prefix public
  and do **not** place private source video behind the public CDN.

## Bucket CORS policy

In Timeweb Object Storage, configure CORS for the single production web origin.
Use the staging origin only in the staging bucket, rather than permitting every
domain in production.

```json
[
  {
    "AllowedOrigins": ["https://4short.ru"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Accept-Ranges", "Content-Range", "Content-Length", "Content-Type", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

If the production dashboard is hosted at another exact origin, replace only
`https://4short.ru`; do not add a wildcard as a convenience. Keep this document
and `WEB_ORIGIN` in the control API deployment aligned.

## Acceptance check

After uploading a non-sensitive test MP4 through the normal flow, open its
editor. The API makes a one-byte signed-range probe before allowing Canvas
composition preview. If it is rejected, the editor intentionally stays in
source/final-render mode and logs only the reason — never the signed URL.

Run this from a trusted machine after authenticating and obtaining a temporary
URL through the application, not by pasting production credentials into a
shell:

```text
GET <signed-preview-url>
Origin: https://4short.ru
Range: bytes=0-0

Expected: 206; video/*; Access-Control-Allow-Origin: https://4short.ru;
Accept-Ranges: bytes; Content-Range: bytes 0-0/...
```

The test video must then be deleted through the retention/admin flow.
