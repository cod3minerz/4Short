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
    "AllowedOrigins": ["https://narezai.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Range", "Content-Type", "x-amz-date", "x-amz-content-sha256"],
    "ExposeHeaders": ["Accept-Ranges", "Content-Range", "Content-Length", "Content-Type", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

This is a prepared policy, not yet applied: first verify that Vercel actually serves the
production dashboard at this origin. Browser multipart upload needs `PUT`; completed upload and
abort are performed by the control API. If the production dashboard is hosted at another exact origin, replace only
`https://narezai.com`; do not add a wildcard as a convenience. Keep this document
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
Origin: https://narezai.com
Range: bytes=0-0

Expected: 206; video/*; Access-Control-Allow-Origin: https://narezai.com;
Accept-Ranges: bytes; Content-Range: bytes 0-0/...
```

The test video must then be deleted through the retention/admin flow.
