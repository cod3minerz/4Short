# HVE layout evaluator (G6)

This is the isolated evidence route for automatic screen/presenter,
gameplay/facecam and three/four-person panel direction. It is not a
media-worker job, has no control-API credentials and cannot enable
`HVE_AUTOMATIC_LAYOUT_DIRECTOR_ENABLED`.

The first candidate deliberately starts with explainable CPU components:

- a hashed MediaPipe Face Landmarker identifies opaque face candidates;
- bounded OpenCV contour/edge analysis finds opaque large rectangular regions;
- a topology-only baseline proposes `screen_speaker`, `grid_3`, `grid_4` or
  `portrait_focus` from direct observations;
- an independent evaluator maps candidate IDs to sealed semantic labels and
  measures whether it was actually correct.

The candidate never calls a live project, stores a frame, landmark vector,
embedding, raw audio or user media. A rectangle is not labelled “screen” by
the model. It remains an opaque `structure-*` candidate until an evaluator
maps it against an independently labelled corpus range.

## Boundary and prerequisites

Use the separate `services/hve-evaluator` image on the target 8 CPU / 12 GiB
Timeweb cgroup. It receives only evaluator-owned licensed corpus mounts and
the read-only model pack documented in
[hve-active-speaker-evaluator.md](./hve-active-speaker-evaluator.md). The
candidate verifies the full source SHA-256 before decoding, validates every
model byte through the model manifest and writes mode-`0600` JSON.

Do not run this against customer uploads, the normal media-worker, CI, a
control API deployment, or with a private evaluator key mounted.

## Candidate run

```bash
SOURCE=/secure/corpus/screen-001.mp4
SOURCE_HASH=$(sha256sum "$SOURCE" | cut -d ' ' -f1)

docker build -f services/hve-evaluator/Dockerfile -t fourshort-hve-evaluator:local .
docker run --rm \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  --volume /secure/corpus:/corpus:ro \
  --volume /secure/evaluator/models:/models:ro \
  --volume /secure/evaluator/output:/output:rw \
  fourshort-hve-evaluator:local \
  fourshort-hve-layout-candidate \
    --source-video=/corpus/screen-001.mp4 \
    --source-hash="$SOURCE_HASH" \
    --duration-ms=<manifest-duration-ms> \
    --models-manifest=/models/models.json \
    --model-root=/models \
    --out=/output/screen-001/layout-candidate.json
```

`layout-candidate.json` binds source hash, model/version/code hashes, opaque
regions, temporal decisions and cgroup-v2 resource facts. A process-only
measurement is useful only for debugging and is rejected by the bundle builder.

## Build candidate predictions

An evaluator creates a private mapping after inspecting candidate IDs against
the sealed ground truth. It may map IDs and declare the exact labelled ranges;
it may **not** choose the predicted template or edit region visibility.

```json
{
  "schemaVersion": 1,
  "kind": "hve-layout-director-evaluator-mapping-v1",
  "items": [{
    "itemId": "screen-001",
    "sourceHash": "<exact source sha256>",
    "candidateArtifactSha256": "<exact layout-candidate artifact sha256>",
    "regions": {
      "structure-001": "sealed-screen-region",
      "face-001": "sealed-presenter-region"
    },
    "ranges": [{ "rangeId": "r-1", "startUs": 0, "endUs": 30000000 }]
  }]
}
```

The candidate artifact lives only at
`<candidate-root>/<safe-item-id>/layout-candidate.json`; the builder rejects
path traversal, changed artifact hashes, missing candidate IDs, mixed model
provenance, sub-target hardware and non-cgroup measurements.

```bash
fourshort-hve-layout-bundle \
  --mapping=/secure/evaluator/layout-mapping.json \
  --candidate-root=/secure/evaluator/output \
  --corpus-version=<sealed-corpus-version> \
  --manifest-sha256=<manifest-sha256> \
  --object-index-sha256=<signed-object-index-sha256> \
  --evaluator-key-fingerprint=<evaluator-public-key-fingerprint> \
  --hardware=/secure/evaluator/timeweb-cpu8-12gb.json \
  --out=/secure/evaluator/layout-predictions.unsigned.json
```

Sign the unsigned bundle, then use the signed evaluator workflow in
[verification/hve/README.md](../../verification/hve/README.md#hve-g6-layout-director-evidence).
The scorer rejects absent/mismatched semantic mappings and scores only exact
range matches. It does not reward a candidate for picking an appealing layout
without a labelled preservation result.

## Promotion status

This candidate is a baseline for corpus comparison, not a chosen production
model. HVE-G6 stays scaffolded until a separate evaluator supplies signed
development and holdout corpus evidence with all frozen thresholds, including
at least 24 independent items and 120 independent ranges per required stratum.
Until then, only user-verified screen/gameplay/panel compositions may render.
