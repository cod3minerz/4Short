# HVE active-speaker evaluator

This is an evaluator-only route for HVE-G5. It is not a media-worker stage,
does not accept customer jobs and does not enable an automatic-layout control.
The image contains candidate CPU dependencies only to produce reproducible,
compact evidence on the `timeweb-cpu8-12gb` profile.

## Why the image is separate

The production worker remains the narrow Faster-Whisper/FFmpeg runtime. Its
model and resource envelope must not change because an active-speaker candidate
is being tried. `services/hve-evaluator` uses a separate service account,
private evaluator model mount and evaluator signing key. It may process only
licensed corpus fixtures. It has no Control API credentials, no customer S3
credentials and no public ingress.

The candidate consists of:

- Sherpa-ONNX offline diarization (segmentation + speaker embedding +
  clustering);
- MediaPipe Face Landmarker in video mode at a bounded 4 Hz;
- the existing deterministic HVE association core.

It saves diarized turns, aggregate mouth-motion windows, their association and
resource measurement. It never persists frames, landmarks, embeddings, audio
or model logits. The candidate keeps an association confidence at the
conservative model acceptance floor because neither upstream task offers a
calibrated per-turn/per-face confidence. Only corpus evaluation may promote it.

## Model provisioning

Do not put any model binary in Git, a Docker image or the normal worker's
`/var/lib/4short/models`. Before a model is mounted, the release evaluator must
check its current redistribution terms and record the exact upstream URL,
version, SHA-256 and license reference in a local manifest. The executable
requires exactly these kinds:

```text
sherpa_segmentation
sherpa_embedding
mediapipe_face_landmarker
```

The manifest is intentionally closed and must be stored next to read-only
model files under `/var/lib/4short/evaluator/models`:

```json
{
  "schemaVersion": 1,
  "kind": "hve-evaluator-models-v1",
  "models": [
    {
      "id": "sherpa-segmentation",
      "kind": "sherpa_segmentation",
      "path": "sherpa-segmentation/model.onnx",
      "sha256": "<verified sha256>",
      "version": "<upstream immutable release>",
      "licenseRef": "<reviewed license reference>",
      "sourceUrl": "<reviewed immutable upstream URL>"
    }
  ],
  "fingerprint": "<sha256 canonical payload>"
}
```

There must be exactly three records. Generate `fingerprint` as SHA-256 of the
canonical JSON payload consisting of `schemaVersion`, `kind` and `models` with
sorted keys and compact separators. Do not hand-edit a fingerprint after the
files are validated.

## Candidate execution

Only a release evaluator runs this on a development corpus item and verifies
the source hash before the candidate is started. The evaluator itself extracts
mono 16 kHz PCM audio into scratch from the same exact video bytes; it never
accepts a separate caller-provided WAV:

```bash
SOURCE=/secure/corpus/item.mp4
SOURCE_HASH=$(sha256sum "$SOURCE" | cut -d ' ' -f1)

docker build -f services/hve-evaluator/Dockerfile -t fourshort-hve-evaluator:local .
docker run --rm \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  --volume /secure/corpus:/corpus:ro \
  --volume /secure/evaluator/models:/models:ro \
  --volume /secure/evaluator/output:/output:rw \
  fourshort-hve-evaluator:local \
  fourshort-hve-active-speaker-candidate \
    --source-video=/corpus/item.mp4 \
    --source-hash="$SOURCE_HASH" \
    --duration-ms=<manifest duration in milliseconds> \
    --models-manifest=/models/models.json \
    --model-root=/models \
    --output-dir=/output/item-001 \
    --scratch-dir=/output/scratch \
    --analysis-id=<evaluator UUID> \
    --source-id=<opaque evaluator UUID>
```

The command writes only mode-`0600` JSON files:

```text
diarization.json
mouth-activity.json
active-speaker-artifact.json
candidate-run.json
```

`candidate-run.json` records the candidate model-manifest fingerprint, source
hash, raw evidence/artifact hashes, association-code hash, cgroup-v2 peak RSS,
swap, process cold-start time and real-time factor inputs. A record with an
unmatching source hash is rejected before any inference. A process-only metric
is valid for local diagnosis but cannot enter a promotion bundle.

The four files are assembled in a private sibling staging directory and
published by one atomic directory rename. An existing output directory is
rejected rather than overwritten. Therefore a stopped evaluator leaves no
partial candidate bundle that a later benchmark could mistake for completed
evidence.

## Benchmark assembly and promotion

The candidate cannot map anonymous diarizer/track IDs to human annotation IDs.
That mapping is evaluator-owned and belongs in the signed prediction bundle;
it must never be derived from customer data or edited by the product service.

1. Read the compact `active-speaker-artifact.json` and create the local,
   evaluator-only mapping file. The tool rejects duplicate mappings and any
   path outside the evaluator output root:

   ```json
   {
     "schemaVersion": 1,
     "kind": "hve-active-speaker-evaluator-mappings-v1",
     "items": [{
       "itemId": "sealed-corpus-item-001",
       "sourceHash": "<sha256 of exact corpus video>",
       "candidateOutput": "item-001",
       "speakers": { "sherpa-speaker-00": "sealed-speaker-a" },
       "faces": { "mediapipe-face-00": "sealed-face-a" }
     }]
   }
   ```

2. Record target-worker hardware once in a local file; it is intentionally
   exact and the builder rejects a smaller profile:

   ```json
   { "profile": "timeweb-cpu8-12gb", "cpuCount": 8, "memoryBytes": 12884901888 }
   ```

3. Assemble the unsigned prediction bundle. This command verifies every model
   hash, the candidate manifest fingerprint, source hash, raw evidence hashes,
   association hash, cgroup-v2 peak RSS/swap measurements and immutable
   association artifact before it writes anything. `process-fallback` metrics
   are useful for development only and are rejected for promotion.

   ```bash
   fourshort-hve-active-speaker-bundle \
     --mapping=/secure/evaluator/mappings.json \
     --candidate-root=/secure/evaluator/output \
     --models-manifest=/models/models.json \
     --model-root=/models \
     --corpus-version=<sealed-corpus-version> \
     --manifest-sha256=<signed-corpus-manifest-sha256> \
     --object-index-sha256=<signed-object-index-sha256> \
     --evaluator-key-fingerprint=<ed25519-public-key-sha256> \
     --hardware=/secure/evaluator/timeweb-cpu8-12gb.json \
     --association-code=/app/fourshort_worker/association.py \
     --out=/secure/evaluator/active-speaker-predictions.unsigned.json
   ```

4. Sign labels and predictions with the evaluator Ed25519 key, then use
   `npm run hve:evaluate:active-speaker` and `npm run hve:verify:active-speaker`.

The verifier requires 24 independently sourced items and 120 adjudicated turns
for both `clean_two_person` and `panel_hard`. Any smaller run, resource breach,
missing signature or failing metric remains `INSUFFICIENT`/failed. It does not
unlock active-speaker tracking in the product.
