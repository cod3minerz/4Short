# HVE verification and release gates

Current unit tests prove helper arithmetic and filter strings, not production media quality. HVE requires an independent verifier, a versioned private corpus and evidence attached to every release.

## 1. Verifier boundary

Do not add VMAF, evaluation models and heavy metrics to the production worker image.

```text
services/hve-verifier/
  schemas | corpus | semantic metrics | visual metrics
  media validation | queue simulation | benchmark | reports | gate

verification/hve/
  schemas/
  manifests/{smoke,development,holdout,stress}.json
  thresholds/production-v1.json
  baselines/timeweb-cpu8-12gb-v1.json
```

Media lives in a private Timeweb S3 prefix. Git stores only manifests, annotations, hashes, synthetic fixture recipes and thresholds. Each run emits `metrics.json`, `junit.xml`, `report.html`, contact sheets, diff heatmaps and complete version metadata.

## 2. Corpus

Target corpus after staged growth:

| Split | Sources | Annotated ranges | Use |
|---|---:|---:|---|
| PR smoke | 24 | 60 | fast synthetic/small CI |
| Development | 100 | 800 | algorithm work |
| Sealed holdout | 50 | 400 | release gate only |
| Stress | 30 | 300 | codecs and pathological cases |

Target at least 75 hours total. Split by author/studio/source, never by fragments from the same recording. Russian content is at least 70%; include mixed Russian/English speech.

Mandatory strata:

- solo, two-person single shot, two-camera podcast, 3 and 4+ participants;
- remote grid, panel/show, screen + speaker, presentation, screencast;
- gameplay + facecam, gameplay without facecam, overlays/chat;
- B-roll/voiceover, no speech and audio-only;
- off-screen speech, overlapping speech, occlusion, bad light, embedded captions;
- horizontal, square, vertical, 24–60 FPS, VFR, H.264/HEVC/VP9/AV1, MOV/MKV/WebM;
- quiet/clipped/noisy audio, music, missing audio and damaged containers.

Only owned, licensed or explicitly consented media may enter the corpus. User production media is never added automatically.

## 3. Ground truth

Use half-open time intervals and PTS for VFR. Annotation contains:

- shots and content type;
- face, screen, facecam and important-region tracks;
- speaker turns and active visible face mapping;
- preferred, acceptable and forbidden layouts per range;
- transcript words and word timing;
- crop/safe-zone/collision constraints;
- annotator, adjudication and license reference.

Creative layout truth is a set of acceptable outcomes, not one exact aesthetic choice. Two annotators label development/holdout; an adjudicator resolves disagreements. Holdout annotations are unavailable to implementation agents.

## 4. Test pyramid

### Unit and property tests

Test interval math, slot/crop geometry, easing/hysteresis, layout applicability, caption grouping, EDL canonicalization, collision resolution, time maps, render hashes and job state transitions.

Property invariants:

- timestamps are monotonic and within source/output bounds;
- crops and slots remain inside canvas;
- interpolation remains continuous away from hard cuts;
- required slots do not overlap illegally;
- caption/layer durations are positive;
- canonical hash is JSON-key-order independent;
- idempotency cannot create duplicate artifacts;
- expired lease cannot allow two completions;
- changing one clip cannot change another clip’s render hash.

### Integration

Run real FFmpeg, ffprobe and libass with pinned fonts; production Zod contracts; PostgreSQL 16; MinIO S3 test double; Toxiproxy failures; actual VAD/vision models for media suites.

Generate deterministic synthetic fixtures with FFmpeg test sources, moving rectangles, beep+flash A/V markers, scene switches, black/freeze sections and every caption preset.

### Semantic and visual goldens

Semantic comparisons cover scenes, tracks, speaker mapping, layout choices, slot assignments, crop keyframes and fallback reasons.

Visual samples include start/middle/end, transitions, active caption word, speaker switch, banner/title timing and layouts. Compare masks/geometry, SSIM and perceptual hashes; create diff heatmaps. Golden changes require separate review from algorithm changes.

## 5. Quality metrics and initial gates

The numeric values below are provisional engineering targets while `production-v1.json` has `gate.status: scaffold`; they are not release evidence. Thresholds become active only after development-corpus calibration, independent review and a signed Timeweb baseline. They are then frozen before the sealed holdout is opened.

### Scene/region/content

- scene F1 within 500 ms >= 0.94;
- content macro-F1 >= 0.90, no production stratum below 0.80;
- facecam region recall >= 0.95 at IoU >= 0.70.

### Active speaker

- clean two-person F1 >= 0.92;
- panel/hard F1 >= 0.85;
- off-screen false assignment <= 2%;
- switch latency p95 <= 600 ms;
- speaking face safely visible >= 98% of speaking time.

The active-speaker evaluator is a separate, evaluator-only command. It accepts
signed compact corpus labels and signed candidate outputs, verifies that they
bind the exact raw manifest and signed S3 object index, then computes
duration-weighted F1, visible coverage, off-screen false assignments and
switch-latency. Promotion requires at least 24 independently sourced items and
120 adjudicated turns for each required stratum; smaller runs are
`INSUFFICIENT`, not a green benchmark. See `verification/hve/README.md` for
the key separation and command flow.

Published third-party metrics are not release evidence. Light-ASD, for example, must pass HVE’s own Russian corpus.

### Crop/tracking

- out-of-bounds = 0;
- must-keep face/head coverage >= 98% of speaking time;
- head-cut frames <= 0.5%;
- no normalized single-frame jump > 0.08 outside a scene cut;
- long-shot ID switch <= 1;
- minimum layout hold normally >= 1.2 s.

### Layout planning

- acceptable-layout time >= 92%;
- every required stratum >= 85%;
- forbidden layout = 0;
- required screen-region coverage >= 95%;
- unexplained fallback <= 8%.

### STT/captions

- clean Russian WER <= 10%, noisy <= 20%;
- word timing median <= 100 ms, p95 <= 250 ms;
- glyph clipping and safe-zone collisions = 0;
- preview/final planned geometry difference <= 2 px;
- timing difference <= one output frame.

### Final media

- full decode success 100%; monotonic PTS;
- duration delta <= one frame + 40 ms;
- A/V sync p95 <= 80 ms on marker fixtures;
- loudness `-16 ± 1 LUFS`, true peak <= `-1 dBTP`;
- unexpected black/freeze = 0;
- H.264/AAC, yuv420p, faststart;
- VMAF is measured only against a lossless composited reference with identical geometry; initial median >= 96 and p5 >= 92.

## 6. Resource and performance evidence

Every worker stage returns flat versioned metrics compatible with the control API:

```json
{
  "wallSeconds": 42.1,
  "mediaSeconds": 60,
  "rtf": 0.702,
  "cpuSeconds": 263.4,
  "peakRssBytes": 6250000000,
  "scratchPeakBytes": 1450000000,
  "bytesRead": 83000000,
  "bytesWritten": 21000000,
  "framesDecoded": 1800,
  "framesAnalyzed": 240,
  "cacheHit": false
}
```

Before a target-worker benchmark or planned maintenance, place the worker in
drain mode. A drained worker completes its existing attempt but does not claim
another; the queue also rejects its registration server-side. This protects
the benchmark envelope from a hidden customer job without turning drain into
an unsafe process kill. The runbook is
`docs/operations/hve-worker-benchmark.md`.

Safety gates on the real 8 CPU / 12 GB worker:

- peak worker RSS <= 9 GB;
- available memory never below 1.5 GB;
- OOM and sustained swap = 0;
- scratch remains at least 12 GB free during benchmark;
- no source or orphan temp remains after cleanup;
- initial 60-second 1080p render p95 RTF <= 2.0.

Create a signed baseline `timeweb-cpu8-12gb-v1.json`. After approval, p95 wall regression is <= 10%, RSS <= 5% and scratch <= 10%. A failed candidate may not overwrite the baseline.

## 7. Queue verification

Tests use the real PostgreSQL `claimNextJob()` path.

The repository's integration harness continuously replenishes three queued
jobs for each of 30 workspace records over 65% of a two-hour virtual service
window. It checks zero starvation, a maximum virtual wait and a ±15% weighted
service-share envelope on the durable claim path. This is scheduler evidence,
not a substitute for target-worker CPU/RAM, provider-latency or ETA coverage
measurements.

Properties:

- two workers never receive one job;
- expired/late lease completion cannot double-complete;
- retry preserves idempotency;
- provider waiting consumes no CPU slot;
- a workspace cannot monopolize a clip series;
- age boost prevents starvation;
- a failed clip does not stop siblings.

Load scenario: 30 continuously backlogged workspaces across all plans and mixed job classes for at least two virtual hours at offered load <= 65% measured capacity.

Gates:

- starvation = 0;
- weighted Jain fairness >= 0.95;
- service share within 15% of entitlement;
- no more than two consecutive eligible jobs from one workspace when others wait;
- 80–95% jobs finish inside displayed ETA range.

## 8. Editor parity and reliability

Playwright and final frame extraction verify:

- draft roundtrip preserves canonical document;
- undo/redo restores canonical equivalence;
- stale `baseVersion` cannot overwrite;
- one clip rerender does not touch siblings;
- browser vs final slot/crop/caption/layer geometry <= 2 px;
- line breaks and safe zones match;
- rapid edits coalesce without lost commands or duplicate renders;
- signed URL expiry, offline autosave, suspended tab and capability downgrade recover safely.

UI budgets are defined in `hve-editor-architecture.md` and are release gates, not aspirations.

## 9. CI levels

### PR, <= 10 minutes

- schema/contract and migration tests;
- unit/property tests;
- synthetic media and one short real FFmpeg render;
- ASS visual snapshots;
- queue concurrency smoke;
- editor reducer/draft tests.

The media-worker job also builds the immutable production image and executes
selected HVE render slices **inside that image**. This includes an actual
`cv2.FaceDetectorYN` construction using the pinned YuNet file. Presence of an
ONNX file, an importable `cv2` module, or a skipped detector test is not
evidence that the deployed image can perform face analysis.

PR runs use synthetic fixtures and explicitly pinned tiny/test adapters where a real production model would exceed the budget. Their reports must label the model class as `test_adapter`; they can prove contracts and failure behavior but cannot satisfy model-quality gates.

### Nightly

- development corpus with actual models;
- semantic/visual goldens;
- PostgreSQL fairness simulation;
- MinIO/Toxiproxy integration;
- browser parity matrix subset.

Nightly media/model suites run on a self-hosted worker that matches the Timeweb image and uses the real pinned production weights. Hosted GitHub runners are not accepted as resource or model-quality evidence.

### Release candidate

- sealed holdout and stress corpus;
- real Timeweb benchmark;
- chaos suite and full media validation;
- human contact-sheet review;
- billing/idempotency/lease recovery.

Roll out as shadow analysis -> 5% -> 25% -> 50% -> 100%. Automatically stop/roll back on render validation spike, resource violation, quality fallback spike, queue SLO regression or manual-correction regression.

## 10. Chaos cases

Kill worker during STT/render, restart API, time out S3/LLM, interrupt upload, corrupt source/model/font/banner, expire signed URL, lose lease heartbeat, duplicate completion, fill scratch, trigger memory pressure and fail one clip in a series. Verify recovery, one billing outcome, one artifact and no orphan scratch.

## 11. Market claim gate

“Best on the CIS market” requires blinded comparison against HVE previous release, OpusClip, Reels Boss and a manual reference across major content strata. HVE should be preferred in >= 60% comparisons with the lower 95% Wilson bound above 50%, no statistically significant losing major stratum and manual correction rate <= 10%.

No overall average may hide a failed stratum. Insufficient sample size is `INSUFFICIENT`, never `PASS`.

Sealed holdout credentials belong to a release-evaluator role that is separate from implementation credentials. The evaluator launches an immutable candidate image, signs the environment and result artifacts, and publishes only aggregate failures/contact sheets permitted by the corpus policy. Implementation agents cannot read holdout annotations or overwrite its reports.
