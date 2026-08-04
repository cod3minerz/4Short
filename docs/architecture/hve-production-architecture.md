# Hashpix Video Engine v2 — production architecture

Status: target architecture for implementation by Terra. The existing v1 pipeline remains operational while v2 is introduced behind versioned contracts and feature flags.

## 1. Product boundary

HVE is a specialized clip-production engine:

```text
source -> transcript -> semantic moments -> multimodal analysis
       -> editorial plan -> user review/edit -> deterministic render -> QC
```

It is not a free-form NLE. Users can edit narrative segments, crop/layout segments, captions, titles, logo, banner, outro, B-roll and audio policy. They do not manipulate arbitrary tracks, codecs, model parameters, or FFmpeg filters.

The editor and automatic engine operate on the same document. Automatic planning creates an initial version; user edits replace or lock individual decisions without leaving the HVE pipeline.

## 2. Current baseline and mandatory corrections

The repository already has PostgreSQL workspaces and billing, S3 uploads, a leased queue, Faster-Whisper, LLM moment search, YuNet tracking, ASS subtitles, FFmpeg rendering and independent clip jobs. Keep that control-plane foundation.

Do not extend the current renderer with more `if mode == ...` branches. Its v1 EDL has one layout for an entire clip and cannot express scene changes, multiple overlays, audio edit maps or decision provenance. The v2 path must also close these present gaps before a public production claim:

- `cuts` and silence removal must affect audio and video;
- transcript edits must survive schema validation and affect subtitles/render;
- banner, logo and timed title layers must render;
- requested layouts must not silently become center crop;
- active speaker requires audio-speaker-face association;
- preview must use the same resolved geometry as the final render;
- drafts must be stored server-side and committed atomically;
- validation must cover full decode, A/V sync, frozen/black frames, crop safety and collisions.

## 3. Components

```text
Control API
  orchestration | manifests | drafts | versions | queue | billing | SSE
        |
PostgreSQL ------------------------- private Timeweb S3
  state, ledger, leases               media, proxies, analysis, plans, outputs
        |                                      |
HVE worker pool -------------------------------+
  ingest -> perception -> director -> planner -> renderer -> verifier
        |
Web editor
  proxy playback -> resolved plan -> live overlays -> draft commands
```

### Control API

Split the current pipeline service into explicit application services:

```text
services/control-api/src/services/hve/
  orchestration.ts
  analyses.ts
  plans.ts
  drafts.ts
  versions.ts
  renders.ts
  reconciliation.ts
```

The API owns state transitions and idempotency. It never downloads or transforms video.

### HVE worker

Create bounded modules rather than one stage file:

```text
services/media-worker/src/fourshort_worker/hve/
  ingest/       probe, proxy, thumbnails, waveform
  speech/       stt, alignment, diarization
  vision/       scenes, regions, faces, tracking, motion, screen detection
  association/  active speaker and source-region identity
  classify/     content and scene roles
  director/     candidate layouts, scoring, hysteresis, fallback
  planner/      geometry, captions, collisions, audio edit map
  renderer/     compositor, layers, audio, encoder
  quality/      semantic, visual and media verification
```

Each module reads versioned artifacts and produces a new immutable artifact. It must not mutate previous analysis.

## 4. Pipeline stages

| Stage | Class | Output | Retry boundary |
|---|---|---|---|
| Probe | light CPU/IO | media facts | source hash |
| Proxy | heavy CPU only if needed | 540p/720p browser proxy | proxy profile |
| Speech | heavy CPU | words and utterances | audio hash + model |
| Scenes | light CPU | shot boundaries | proxy hash + detector |
| Regions | light/medium CPU | screen, slide, gameplay, facecam candidates | scene artifact |
| Face detect/track | medium CPU | sparse face tracks | selected ranges + model |
| Diarize/associate | medium CPU | speaker turns and face mapping | speech + tracks |
| Classify | light CPU/LLM | content/scene roles | normalized features |
| Direct | light CPU | editorial layout decisions | analysis + policy |
| Plan | light CPU | resolved geometry/time/audio/captions | document + assets |
| Render | heavy CPU | MP4, SRT/VTT, poster | plan hash |
| Verify | light/medium CPU | quality report | rendered artifact |

Provider waiting is a database state, not a worker slot. Dense analysis is restricted to moment ranges selected for preview or rendering; the full source receives cheaper sparse analysis.

## 5. Perception stack

### Speech

- Default CPU STT: Faster-Whisper Large V3 Turbo, word timestamps, VAD segmentation.
- Maintain an adapter boundary for alternative local or API STT.
- Use a Russian/CIS benchmark corpus to choose model/compute type; do not hard-code a provider into domain contracts.
- Forced alignment is optional per-language. WhisperX can be evaluated as an offline alignment adapter, but its PyTorch dependency must not enter the base worker image until memory and license gates pass.
- Diarization is a separate artifact. On the CPU worker prefer VAD plus ONNX speaker embeddings and clustering; cache embeddings, not audio snippets.

### Scene and region understanding

- PySceneDetect content/adaptive detectors are suitable for shot boundaries and should run on the proxy.
- Detect faces sparsely at 2–4 FPS, then track between observations. Replace the current greedy IoU tracker with motion-aware association; ByteTrack-style association is the reference, not a mandatory dependency.
- Detect large stable rectangles, screen changes, text/slide density and facecam-sized regions to classify screen-share/gameplay structures.
- Store region coordinates normalized to source display orientation after rotation is applied.
- Never persist raw frames. Sparse keyframes and compact feature artifacts go to S3.

### Active speaker

Active speaker is a mapping problem:

```text
audio -> diarized speaker turn
video -> face tracks and mouth-motion windows
association -> P(face track speaks | turn, time)
```

Start with aligned speaker turns + mouth motion + persistence. Add Light-ASD as an optional ONNX/batched classifier only if it improves the golden corpus materially. The planner consumes confidence and fallbacks; it never assumes the mapping is certain.

### Content taxonomy

Classify per scene and allow changes inside one clip:

- solo talking head;
- two-person interview;
- 3–4 person panel/show;
- remote call grid;
- screen share with presenter;
- gameplay with facecam;
- gameplay/screen recording without facecam;
- vertical source;
- slides/product demo;
- mixed/unknown.

The classifier returns probabilities and evidence. Low confidence routes to conservative layouts, not aggressive crops.

## 6. Scene graph and layout director

The scene graph is a time-indexed union of shots, speaker turns, face tracks, screen regions and user locks. The director converts it into `LayoutSegment[]`.

### Layout registry

Every layout is data-driven and compiled by one slot compositor:

| Layout | Slots | Typical use |
|---|---:|---|
| fill | 1 | active speaker, safe portrait crop |
| fit | 1 | preserve full source with background |
| split-2 | 2 | dialogue/podcast |
| grid-3 | 3 | panel/show |
| grid-4 | 4 | panel/call |
| screen-presenter | 2 | screen 65–78%, presenter remainder |
| gameplay | 2 | facecam 25–32% top, gameplay remainder |
| picture-in-picture | 2 | presentation with inset speaker |
| media-plus-image | 2 | video and uploaded visual |
| vertical-pass | 1 | already-vertical source |

Each template declares normalized destination slots, safe padding, accepted region roles, fit strategy, background and transition policy. The renderer receives slots; it does not know product layout names.

### Director scoring

For candidate layout `L` over segment `t`, score:

```text
S = faceSafety + speakerCoverage + contentCoverage + continuity
  + userPreference + platformSafety
  - cropLoss - switchCost - uncertaintyPenalty - collisionRisk
```

Rules:

- minimum segment length normally 1.2–1.8 s;
- hysteresis prevents switching on short speaker interjections;
- cut boundaries are preferred switch points;
- do not switch more than a configurable rate per minute;
- retain screen/gameplay visibility during relevant speech;
- user-locked segments override automation;
- every fallback records a reason and warning code.

## 7. Planner and deterministic renderer

The planner resolves all ambiguity before render:

- source-time to output-time map after trim, cuts and pause removal;
- layout segment boundaries;
- slot rectangles and crop keyframes;
- line breaking and caption groups;
- layer placement, timing and z-order;
- safe-zone and face/caption collision resolution;
- audio cut/crossfade/normalization plan;
- font and asset hashes.

The final renderer then performs only deterministic transforms:

```text
ResolvedRenderPlan
 -> FFmpeg filtergraph + ASS
 -> H.264/AAC faststart MP4
 -> thumbnail, SRT/VTT, optional ZIP
```

Use a generalized slot compositor built from crop/scale/pad/overlay primitives. Render each source region once per required slot, not once per UI feature. Titles, banners, logos and B-roll are timed layers. Audio edits use the same output time map as captions.

Cache identity includes source hashes, canonical document, resolved plan version, renderer build, fonts, assets and export profile. A cache hit is valid only after its quality report passed.

## 8. Queue and resource admission

The current PostgreSQL lease queue remains. Add capability matching and local admission:

- job requirements: engine version, models, CPU/GPU, RAM estimate, scratch estimate, codecs;
- worker capabilities: installed model hashes, renderer version, slots and current RSS/disk;
- job classes: `io`, `provider`, `cpu_light`, `cpu_medium`, `cpu_heavy`;
- per-workspace active limits and weighted fair scheduling;
- age boost prevents starvation;
- cancellation tokens checked between stage checkpoints.

Initial policy for 8 vCPU / 12 GB:

- `cpu_heavy`: 1;
- `cpu_medium`: 1 only when no heavy job exceeds its measured memory envelope;
- `cpu_light`: 1 alongside heavy if load and disk thresholds allow;
- `io/provider`: up to 2, with network and file descriptor limits.

FFmpeg thread count is bounded per job. More threads are not automatically faster; the benchmark determines the encoder preset and thread allocation. Parallelism comes primarily from independent clip jobs across workers.

## 9. Storage and retention

PostgreSQL stores manifests and business state. Private Timeweb S3 stores:

- originals and proxies;
- waveforms/contact sheets;
- analysis artifacts (JSON/MessagePack/Parquet depending density);
- resolved plans;
- rendered outputs and quality reports;
- private verification corpus.

All artifact keys are content-addressed or contain opaque IDs. No email or original filename appears in object keys. Signed URLs are short-lived and range-enabled. Local NVMe is scratch only and is cleaned after upload or expired lease recovery.

## 10. Observability

Every stage records:

- queue wait and wall time;
- CPU seconds, peak RSS and scratch peak;
- bytes read/written;
- input/output artifact hashes;
- model, schema, planner and renderer versions;
- retry/fallback/warning codes;
- realtime factor where duration applies;
- estimated vs actual cost.

Quality and performance metrics feed admin views and release gates. Never log source URL, transcript text, filenames or signed URLs.

## 11. Security and licensing

- FFmpeg is invoked without shell interpolation and with time/resource limits.
- Import is protected against SSRF and restricted by domain/redirect policy.
- Fonts, image and video layers are probed and normalized before use.
- Workers are rootless containers with per-job temp directories.
- Model weights are pinned by hash with recorded licenses.
- External code is adopted only after license, maintenance, resource and corpus-quality review.

External providers are governed per capability, not by one global “AI provider” switch. STT, moment search/classification, translation, B-roll and music each have an explicit routing policy with allowed data classes, processing region, retention/logging terms, legal basis, workspace consent, cost ceiling, timeout, circuit breaker and local/fallback behavior. Transcript text, frames or audio may never leave the configured contour merely because the preferred provider is unavailable. The provider and policy version are recorded in the job and usage-cost metadata without storing user content in analytics.

Candidate references, not automatic dependencies: [WhisperX](https://github.com/m-bain/whisperX), [PySceneDetect](https://github.com/Breakthrough/PySceneDetect), [Light-ASD](https://github.com/Junhua-Liao/Light-ASD), [OpenCut](https://github.com/OpenCut-app/OpenCut).

## 12. Definition of production HVE

HVE is production-ready only when:

- all public controls compile into executable plans;
- no requested layout silently degrades;
- the golden corpus passes semantic, visual, A/V and resource gates;
- preview/render parity is measured;
- jobs resume after worker loss;
- one clip failure does not block others;
- queue fairness and ETA are load-tested;
- a version can be canaried and rolled back without rewriting user projects.
