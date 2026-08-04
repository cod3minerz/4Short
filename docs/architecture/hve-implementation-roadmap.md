# HVE v2 implementation roadmap for Terra

This is the execution order. Do not start with more UI controls or a 3/4-person layout branch. Each iteration must leave the system deployable and pass its gate before the next begins.

## Operating rules

- Preserve current v1 projects and renders through adapters.
- One pull request should deliver one vertical slice and its verification evidence.
- Contracts and migrations land before producers/consumers.
- Feature flags select HVE v2 per workspace/project/clip.
- A public control appears only when its end-to-end slice works.
- Update `.claude/skills/backend-capability-map/SKILL.md` after proven changes.
- A `ready` media corpus is not trusted from its JSON manifest: an evaluator-only
  S3 reader must stream-hash every source, annotation and license artifact into
  an Ed25519-signed object index. `hve:corpus:verify` verifies the index against
  the exact manifest bytes and the evaluator public key; a scaffold, unsigned
  index or missing key is `INSUFFICIENT`, never a quality pass.
  `hve:manifest:lint` is schema-only and is intentionally named and reported as
  such; it cannot be reused as corpus verification.

## HVE-0 — freeze baseline and expose gaps

Goal: make current behavior measurable and prevent false UI promises.

Work:

- pin engine/model/FFmpeg/font versions;
- add stage resource metrics and warning codes;
- make unimplemented layout/layer controls locked or explicitly warned;
- fix stale-rerender error propagation;
- add real short FFmpeg render integration test;
- seed synthetic smoke corpus manifest and validator;
- record initial Timeweb worker baseline.

Gate: current v1 functions pass full decode/smoke checks; no enabled control is silently ignored.

## HVE-1 — v2 contracts, artifacts and compatibility

Goal: introduce the domain without changing user output yet.

Files:

```text
packages/contracts/src/hve-analysis.ts
packages/contracts/src/hve-plan.ts
packages/contracts/src/clip-document-v2.ts
packages/contracts/src/editor-draft.ts
packages/contracts/src/engine-events.ts
db/migrations/*hve_v2*
services/control-api/src/services/hve/*
```

Work:

- implement schemas from `hve-contracts.md`;
- canonical serializer/hash and property tests;
- `ClipEDLV1 -> ClipDocumentV2` adapter;
- manifest tables and S3 artifact repository;
- engine release/capability records;
- stage idempotency keys include all version/hash inputs;
- add the minimum safe scheduler contract now: `cpu_medium`, capability/requirements matching, engine/model hashes, provider-waiting jobs that consume no media slot, memory/scratch admission and per-workspace active limits.

Gate: v1 clips import into v2 without semantic loss; schema, canonical-hash, adapter-roundtrip, migration and scheduler-admission tests pass. Render equivalence is deliberately deferred until the v2 compositor exists in HVE-3.

## HVE-2 — time map, captions and audio

Goal: complete the editing primitives that UI already promises.

### Iteration status — executable single-source timing slice (implemented, not publicly enabled)

- `packages/contracts/src/hve-time-map.ts` produces a contiguous integer-microsecond
  source-to-output map from narrative order, explicit source cuts, transcript
  `cutFromMedia` edits and conservative word-gap pause cuts;
- the same map drives planned caption cues, SRT and VTT output, so removed media
  cannot silently retain an out-of-sync caption;
- the control API resolves an immutable `ClipDocumentV2` plus canonical transcript
  words into an execution payload. It refuses multi-source timelines, rate changes
  and production layers rather than silently dropping them. A pause-only crossfade
  is now an explicit `transitionInUs` overlap in that same map; user/text cuts
  remain hard cuts;
- unit coverage verifies interval normalization, no output gaps, text cuts, pause
  padding, caption overrides and serialization.

The worker now consumes that HVE-2 one-source 1× time map when it is present:
it concatenates the same retained ranges for video and audio before visual filtering,
burns the output-timed ASS cues, applies bounded loudness normalization, validates
post-cut duration, and records child-process RSS/CPU/I/O telemetry. The route is a
safe compatibility path for persisted V2 rerenders only; no dashboard control or
initial-project path enables it yet.

The worker executes that narrow crossfade subset as matched FFmpeg `xfade` and
`acrossfade` operations before any static HVE-3 compositor pass. The fade duration
and final output duration therefore match the caption plan and render EDL exactly.
The browser's single-source review player deliberately refuses such a plan instead
of pretending to preview a blend it cannot draw.

This is **not** an HVE-G2 pass: the remaining gate work is caption-plan/ASS
evidence on a libass-capable runtime, every preset's visual golden and safe-zone
checks, real corpus benchmarks and deterministic artifact-cache evidence. Keep
product controls disabled until those are in place.

Work:

- narrative segment time map;
- trim, text cuts and VAD pause cuts affect audio/video;
- pause-only crossfades and loudness normalization;
- transcript edits flow to resolved captions;
- server-planned caption groups/line breaks;
- SRT/VTT output.

Gate: time-map property suite, A/V marker tests, every subtitle preset visual golden, full decode and deterministic cache hit.

### HVE-Q1 — render integrity observations (implemented, non-blocking)

The mandatory full-decode pass now also runs FFmpeg `blackdetect` and records
bounded output-clock black-segment observations on the render validation. This
does not reject a deliberate dark scene, title card or fade; it is an
`observation_only` signal for later product review policy. A worker image that
lacks the filter still performs a full decode and reports visual QC as
unavailable rather than claiming it passed. Freeze, caption-collision and
semantic quality remain separate corpus-gated work.

Render-hash cache reuse is now bounded to the same workspace and only admits a
retained, non-deleted artifact whose persisted media validation has passed. A
cache hit creates the new clip-version binding before the clip becomes ready;
it cannot manufacture a "ready" status with no downloadable artifact.

## HVE-3 — generalized slot compositor

Goal: replace layout-specific FFmpeg branches.

### Supporting media derivative — browser proxy (implemented, internal)

The control plane now creates a private, bounded browser proxy only after a
source probe determines that the original is browser-incompatible. It is a
separate delayed CPU-medium job and never blocks transcription, moment finding
or the source-minute charge. The worker produces and validates a 720p-max,
30fps H.264/AAC/yuv420p faststart MP4 before storing it under the source hash.
The original source remains canonical. A live proxy may be selected for later
sparse perception to reduce decode cost; missing, deleted or expired proxies
must always fall back to the original. This is an execution optimization, not a
claim of browser/final-preview parity or a public transcode setting.

### Iteration status — generic source-slot compositor with planner-owned crop motion (implemented, not publicly enabled)

- `packages/contracts/src/hve-layout.ts` provides the first normalized template
  registry (portrait, blur, split, screen/speaker, gameplay/facecam, PiP and
  3/4 grids) and resolves anchors into one rounded pixel plan;
- unknown templates produce a visible safe fallback warning; missing slots,
  overlapping layout ranges and unavailable word anchors fail before render;
- `compile_resolved_layout_filter()` consumes only resolved slots. It does not
  branch on a template name and has a full-decode two-crop fixture proving
  independent source crops land in separate output regions;
- `packages/contracts/src/hve-preview.ts` projects the same immutable time
  map, slot geometry, crop interpolation and captions for a future native
  browser sequence player. It has no media/model access and fails closed on a
  gap, multi-source plan or incomplete crop; this prevents a browser preview
  from inventing a different crop clock than FFmpeg;
- the executor accepts one or more source-only layouts when their ranges are
  exactly contiguous and cover the full output clock. Every segment is
  composited independently from the stitched A/V stream and concatenated back
  as an explicit hard cut; its crop position can move only when the resolved
  plan covers that segment and uses one fixed crop size. A zoom, gap,
  incomplete trajectory or unavailable artifact fails closed. It performs no
  tracking or speaker inference. Crossfades remain refused because they would
  change the shared caption/layer clock. It is used only by the internal
  typed-draft commit and rerender paths for persisted V2 clips; both paths
  rebuild the identical plan, verified perception context (when requested) and
  private asset snapshot instead of reviving a legacy EDL. It is not selected
  by the initial-project pipeline or exposed as an uncontrolled public layout
  picker.
- a V2 text title can now resolve to an immutable output-clock range, rounded
  pixel box, opacity and versioned `hve-title-v1` typography. The worker burns
  that resolved data through ASS and a synthetic FFmpeg fixture checks both
  presence and absence outside its range.
- static `image`, `logo` and `banner` layers now have a private, executable
  path: browser multipart upload creates a pending workspace asset; completion
  byte-checks PNG/JPEG/WebP signatures, size and SHA-256 in private S3; the
  planner records only immutable asset metadata in the resolved plan; the
  worker downloads from its own S3 credentials, rechecks SHA-256 and burns the
  asset at its resolved output geometry and interval. A synthetic FFmpeg
  fixture proves the overlay appears only inside that output range.
- a verified `video` layer now has a narrowly scoped executable path: it is a
  bounded, aspect-preserving, output-clock visual overlay. Its source audio is
  never mixed, a non-looped file must cover its full output range, and a
  synthetic FFmpeg fixture verifies it appears only inside that range without
  shortening the narrative clip.
- HVE-8 adds an internal, user-supplied B-roll primitive with deliberately
  different semantics: only a verified `broll` MP4 may replace the complete
  visual canvas for a non-overlapping bounded output range; it is opaque,
  cannot loop, always preserves narrative audio and remains below captions,
  title and foreground branding. Partial B-roll, B-roll audio, short assets
  and overlapping ranges fail before a version is queued. A synthetic FFmpeg
  test observes blue narrative visuals before/after and red B-roll visuals in
  range while confirming that the source 440 Hz narration — not the B-roll's
  880 Hz audio — survives. It is not publicly enabled: generated B-roll,
  music, cost ledger and browser-preview parity are still HVE-G8 gaps.
- `outro` still fails closed because it needs distinct end-of-timeline and
  optional audio semantics; it must not masquerade as an overlay.
- Timed brand-media ingestion is now staged independently of the compositor:
  only bounded MP4 uploads (at most 100 MiB) can become a pending `video`,
  `broll` or `outro` asset. A CPU-light worker job downloads the exact object
  by API-owned key, validates H.264/yuv420p with optional AAC, runs a full
  decode, hashes it incrementally and records the verified facts. The
  verified `video` kind is admissible only to the muted
  overlay renderer above; the internal B-roll executor is the strict
  full-canvas/no-loop path described above, while outro remains unavailable.
  No timed asset audio is accidentally mixed into a clip. Failed verification
  remains non-renderable and the temporary object expires under the upload
  lifecycle.
- final subtitles and title layers now resolve through the pinned
  `hve-sans-v1` font pack (`DejaVu Sans` in the worker image). Arbitrary host
  families and `fontAssetId` are rejected at planning time rather than silently
  falling back in libass. The current renderer version includes the pack
  version; custom-font upload remains a separate, not-yet-enabled pipeline.
- production layers now receive a deterministic, output-clock caption
  safe-zone check during planning. For every active caption cue the planner
  reserves a conservative ASS-compatible envelope; an overlapping title,
  image, logo, banner or video layer with `collisionPolicy: "move"` is moved
  only to a verified canvas edge outside that envelope. `warn` (and any
  unresolved `move`/`shrink`) keeps the authored geometry and returns a
  machine-readable warning rather than silently shrinking or relocating the
  element. B-roll is intentionally excluded because it is the visual base
  beneath captions. This proves planner policy, not pixel-perfect glyph
  collision: visual goldens and browser/final parity are still required before
  a public guarantee.
- a completed render now persists its exact output-clock MP4 plus SRT and VTT
  sidecars as distinct `render_artifacts`; cache reuse copies the complete
  retained set, never only the MP4. A `project_packages` manifest snapshots
  ready clip versions and the worker builds a bounded, traversal-safe ZIP from
  those database-selected artifacts without re-rendering or re-transcribing.
  Packaging admits work only when scratch has room for both inputs and the
  archive, checks every new artifact SHA-256 while downloading, runs a ZIP CRC
  pass before upload, and has a real H.264 package/extract/full-decode smoke.
  The package is retryable from the same immutable manifest and shares output
  retention; it is not exposed by the dashboard yet.

This is **not** HVE-G3 approval: a real browser Canvas/WebGL player and
frame-by-frame browser/FFmpeg parity evidence, timed layout transitions,
timed-media production layers, artifact-backed regions and visual goldens
are still required. Keep all related controls locked or honestly warned until
those slices are connected end-to-end.

The HVE-G3 smoke runner now executes synthetic FFmpeg pixel fixtures for
independent source slots, output-clock dynamic crop, a timed static logo, muted
timed-video overlay (including bounded looping) and a timed text layer, as
well as package/decode validation. This confirms those specific worker paths
are executable. It does not replace browser parity, licensed visual goldens or
the broader overlay/editor semantics still required for the gate.

It also decodes a two-segment output where a source's red left half is used
before the boundary and its blue right half after it. This catches the
otherwise subtle bug where only the first layout record is executed, or crop
keyframes are evaluated on the wrong (absolute versus segment-local) clock.

The CI production-image slice additionally executes the source-cut/A-V-sync,
microsecond time-map, output-timed caption, timed visual overlay and explicit
user-verified gameplay/3-person/4-person composition fixtures inside the
immutable worker image. This avoids treating host-only unit tests as proof that
the image used for deployment has the needed FFmpeg/libass path. It still is
not a corpus-quality or production-hardware benchmark.

Work:

- layout registry and normalized templates;
- compiler to resolved slot geometry;
- FFmpeg slot compositor;
- browser preview compiler for the same plan;
- fill, fit, vertical-pass, blur, manual/static crop;
- split-2 and picture-in-picture using independently assigned regions;
- render title, logo, image/video banner through the same plan; outro stays
  explicitly locked until its end-of-timeline/audio contract exists;
- collision/safe-zone warnings;
- `package_project` light stage for ZIP/SRT/VTT assembly without media re-encoding;
- explicit fallback/warning path.

Gate: browser/final geometry <= 2 px for representative frames; no out-of-bounds; production-layer timing/collision and project-package tests pass; v1 supported layouts render equivalently within tolerance.

## HVE-4 — editor foundation

Goal: replace localStorage-only editor state with a production editor on deterministic HVE semantics.

### Iteration status — server draft and immutable commit boundary (implemented, internal)

- a workspace-scoped `clip_drafts` row persists one normalized V2 document per
  clip, with `baseVersion`, monotonic `revision`, canonical document hash,
  versioned clip/social metadata and append-only command-batch audit records;
- command batches have a UUID idempotency identity and optimistic revision
  precondition. A duplicate request replays safely; a stale tab receives a
  conflict before it can overwrite a newer draft;
- draft save performs no media work. The explicit commit endpoint locks the
  clip, requires the first HVE-3 static-source plan to resolve, creates exactly
  one immutable version (including the same metadata) and queues exactly one
  clip render inside the same idempotent transaction;
- the normal initial render path has a complete adapter for the supported,
  evidence-free subset (`auto`, `static_crop`, `blur_background`, captions,
  title and no asset layers), but it is protected by the explicit
  `HVE_INITIAL_DOCUMENTS_ENABLED=false` rollout gate until the public focus
  editor sends typed draft commands. This prevents the legacy v1 editor from
  creating a lossy follow-up version. Face/screen/gameplay layouts,
  unresolved image assets stay on v1 rather than silently becoming a
  centre-crop HVE document; legacy pause crossfades now import into the
  explicit HVE output clock, while unsupported preview/compositor combinations
  still fail closed;
- legacy versions that lack `documentV2` do not undergo a silent or lossy
  conversion at editor open. They remain on the compatibility path until the
  migration/parity slice is verified.

The focus editor now has an internal typed-draft transport adapter: it maps
only the current executable subset (single-source portrait/blur layout,
captions, text/title, trims, word visibility/cuts, audio policy and export)
to optimistic command batches and commits exactly one immutable version. A
typed title-layer command prevents the UI from turning a visible video title
into metadata-only text. Unsupported layouts and asset controls return a
visible explanation instead of being approximated. This remains behind
`HVE_INITIAL_DOCUMENTS_ENABLED=false` until browser and runtime evidence is
complete.

The adapter also keeps a bounded IndexedDB recovery snapshot of unsent editor
intent. It is restored only when `clipId`, document hash, immutable base
version and server draft revision all match exactly; otherwise it is visibly
left unapplied. This is recovery, not an offline rebase implementation.

Transcript revisions now cross the initial-version boundary explicitly. The
control API snapshots the selected append-only revision alongside canonical
Faster-Whisper words before it creates a HVE document. Hide and cut operations
become per-word document overrides; a segment text replacement is distributed
only across the existing timed words, with an overlong final phrase retained in
the last available word. This changes display text only and never fabricates
audio timing. The resulting document remains immutable: later project
transcript edits affect new versions, not a render already queued from this
one.

The first read-only `editor-manifest` endpoint now returns only a short-lived
source-review URL. It prefers a retained, validated H.264/AAC proxy and uses
the original only when the worker probe proves browser compatibility; object
keys are never exposed. The editor labels this state as source review and does
not draw simulated subtitle, title, banner or logo layers over it. A final
composition preview remains blocked on the resolved-plan `SequencePlayer` and
its parity gate.

This is **not** HVE-G4 approval: exact-identity IndexedDB recovery exists only
for an unsent snapshot and deliberately refuses rebasing. There is still no
offline command queue, two-tab browser test, preview/final parity or full V2
migration. The dashboard must retain truthful locked states until those pieces
and their evidence exist.

Work:

- split editor modules per `hve-editor-architecture.md`;
- server `ClipDraftV2`, command batches and optimistic revision;
- IndexedDB offline queue and conflict UI;
- `editor-manifest` proxy/waveform/thumbnails/assets/font contract;
- native-video `SequencePlayer` + resolved-plan preview with a bounded decoder pool;
- transcript operations and bounded narrative/layout strip;
- trim, split, delete, reorder, per-segment layout and manual crop;
- selection-driven inspector and explicit scope application;
- atomic commit to immutable version, then optional clip-only render.

Gate: reload/offline/two-tab/undo tests, failed save cannot render, standard and enhanced browser paths, mobile sheets and preview/final parity.

## HVE-5 — perception and director v1

Goal: automatic solo/conversation direction.

### Iteration status — sparse source facts and fail-closed director (implemented, internal)

- `analyze_visual` is queued only after a project reaches review, so a single
  worker cannot hold up source import, STT or moment finding. It position-seeks
  to each bounded sparse sample rather than decoding/discarding every source
  frame, and stores an immutable private-S3 scene graph with cut
  boundaries, optional face boxes and explicit warnings; it stores no frames
  or embeddings and does not claim active-speaker, screen or gameplay data;
- the pure HVE director consumes such a graph as a recommendation with a
  decision trace. Composite templates require matching, overlapping verified
  region tracks. Missing evidence produces an explicit safe fallback rather
  than an invented crop or role. The internal clip-scoped recommendation API
  constrains decisions to the exact source interval of the selected moment;
  it re-verifies the source/workspace/hash/orientation/release/artifact hash
  before returning a read-only plan and never changes a draft or queues work;
- the director now applies an internal 1.2s–1.8s hold policy to short layout
  classification fluctuations. It preserves a prior composite only when its
  exact verified regions still cover the transient interval; otherwise it
  chooses a visible safe fallback. Adjacent identical resolved layouts are
  coalesced before preview or render, with an auditable trace. This is
  deterministic plan policy, not active-speaker tracking or a public control;
- this remains HVE-G5 **scaffold status**: no diarization, face/speech
  association, benchmark corpus or public
  automatic-layout control is enabled. The fact graph is now tied to the
  exact registered worker engine-release triple; an unregistered release is
  rejected rather than being attributed to a current worker.
- an explicit face crop track is accepted by editor commit only after the API
  re-reads its private S3 artifact under a byte cap, verifies the persisted
  SHA-256, source hash, source geometry and exact active engine release, then
  compiles it onto the output time map. Kept-range boundaries become explicit
  crop keyframes, so a crop never interpolates across removed media. This is a
  planner-owned visual fact, **not** active-speaker tracking.
- the worker now has a separate `analyze_clip_visual` path. It seeks to an
  explicit selected source range, uses a separately bounded dense sampling
  budget and records source-clock coverage in the same immutable artifact
  format. The internal editor API derives that range from the server-side
  moment and converges duplicate requests into one job. The typed
  `set_crop_track` draft command makes the eventual artifact binding explicit
  before commit; a future editor still has to wait for the job and present
  that choice. Source-wide analysis never silently becomes dense.

Work:

- resolve the diarization and landmark stack through a benchmark ADR before adding it to the base image;
- shot detection on proxy;
- sparse face detection and motion-aware tracks;
- CPU diarization artifact and speaker turns;
- mouth-motion association, confidence and off-screen state;
- solo/conversation classifier;
- director scoring, hysteresis and decision trace;
- dense analysis only on chosen clip ranges;
- user locks and manual crop overrides.

Gate: active-speaker, crop, switch-latency and layout thresholds for solo/two-person strata; fallback is visible and safe.

### HVE-5 association core — implemented, model inputs deliberately gated

`fourshort_worker.association` now provides the deterministic join between
anonymous diarized turns and landmark-derived mouth-motion windows. It uses a
bounded one-to-one score with coverage, detector confidence, contrast and
runner-up margin requirements. Short/ambiguous turns return
`insufficient_evidence`; `offscreen` is only possible after a complete visual
pass observes no face for that turn. HVE now also defines the immutable
`hveActiveSpeakerArtifact` contract: it binds diarization provenance,
compact mouth-motion windows, links and fallback reasons without raw frames,
landmarks, embeddings or audio. No current worker stage emits those model
inputs yet, so this primitive is not wired to a scene graph and cannot unlock
an active-speaker UI control.

`fourshort_worker.active_speaker_evidence` is now the executable evaluator
boundary for the future model adapters. It accepts exactly two bounded JSON
documents — diarized turns and landmark-derived mouth-activity windows — and
rejects a different source hash/duration, unknown fields, raw audio, frames,
landmarks or embeddings. It retains provider/model provenance as hashes only
and compiles the immutable association artifact through the same conservative
scorer. It is a command-line/evaluator tool, not a job type and not a public
API: connecting Sherpa-ONNX or MediaPipe directly to a production worker still
requires the signed corpus and target-worker evidence below.

HVE-G5 now has an evaluator-only evidence route rather than a permissive JSON
checker. The evaluator signs compact labels and candidate predictions, binds
both to the raw manifest and signed S3 object index, computes duration-weighted
per-stratum F1, visible-speaker coverage, off-screen false assignments,
switch-latency, unresolved-switch and RSS/swap metrics, and writes a private
benchmark report. The promotion verifier requires at least 24 independently
sourced items and 120 adjudicated turns in both `clean_two_person` and
`panel_hard`, in addition to frozen target-worker thresholds. `hve:smoke:g5`
invokes this path only with all evaluator inputs; without them it returns
`INSUFFICIENT`, never a false green gate. This proves the evaluation mechanism,
not the candidate models: public active-speaker UI stays locked until a real
licensed corpus and Timeweb CPU8/12GB report pass.

The first candidate environment is now present as `services/hve-evaluator`. It
is intentionally a separate Python 3.12 image, pins Sherpa-ONNX `1.13.4` and
MediaPipe `0.10.18`, requires a closed local model manifest with source URL,
license reference and SHA-256 for every model, and rejects a source whose bytes
do not equal the corpus hash. It sequentially decodes the selected corpus video
at a bounded 4 Hz, runs MediaPipe only in video mode, runs Sherpa only over a
mono 16 kHz PCM input, and writes only the two bounded evidence documents,
their association artifact and resource metadata. It has no production control
plane credentials and no product queue job. This makes target-hardware
benchmarking concrete without adding an unmeasured model dependency to the
customer worker; the promotion report and independent candidate comparison are
still mandatory.

The evaluator additionally assembles prediction bundles only from those
immutable candidate folders. The builder checks source, raw diarization/mouth
evidence, association, code and model-manifest hashes; it maps anonymous IDs
only through evaluator-owned sealed mappings and requires cgroup-v2 RSS/swap
telemetry before a bundle can be signed. It cannot elevate a local
process-fallback measurement into production evidence.

## HVE-6 — panels, screens and gameplay

Goal: high-quality content-aware layouts beyond talking heads.

Implemented bounded foundation:

- The exact user-selected screen/gameplay crop and a separately verified dense
  face track can already compile into a one-source top/bottom gameplay,
  screen/speaker or PiP composition. This is data fed into the generic slot
  compositor, not another renderer mode. The screen crop uses `contain` so a
  slide/game UI is preserved rather than silently cut at the output boundary.
- The planner accepts that tracked facecam route only when the immutable
  source-analysis manifest binds the exact scene-graph bytes to **dense**
  evidence whose source-clock coverage contains every kept narrative interval.
  A sparse source-wide graph, an old artifact without certified density, or a
  partially overlapping dense pass fails closed before render; it cannot
  quietly turn into a plausible but unstable facecam crop.
- A 3- or 4-person podcast/show grid can use the same route when the user
  explicitly assigns a distinct verified face track to each visible slot. The
  registry owns the grid geometry and the generic compositor owns the pixels;
  the engine never guesses who should occupy a panel. Dense, manifest-bound
  evidence is required for every retained source interval before any moving
  face crop enters a grid. The immutable editor draft exposes a dedicated
  typed internal command that accepts only the ordered track identities and
  derives source/analysis bindings from the canonical document; it is not a
  public automatic-layout control. The same draft protocol has a bounded
  screen/gameplay command: it accepts one user-selected source crop and one
  verified face track, then derives the two executable slots server-side.
  A full dense sampling pass is still not enough on its own: every selected
  face track must itself have keyframes covering every retained source range.
  Otherwise commit fails before render instead of silently recentering an
  absent participant.
- The editor can request a bounded `perception` summary for an exact clip.
  It returns only dense-track identities, confidence and coverage facts — no
  frames, embeddings or storage locators — and filters out tracks that cannot
  cover the full retained source range. This prepares a participant picker
  without exposing an automatic-layout control. The dashboard transport has
  typed `requestClipPerception` / `getClipPerception` calls, but no normal
  editor control advertises a layout before the G6 gate has real corpus proof.
- This is intentionally **user-verified**, not screen or gameplay recognition:
  the system has no approved screen/gameplay model or benchmark evidence yet,
  so normal project rendering never selects this route automatically and no
  public automatic-layout control is enabled.
- `npm run hve:smoke:g6` now executes exact user-verified top/bottom and
  three-person grid compositions through the generic FFmpeg slot compositor,
  and projects the same immutable resolved slots through the browser-preview
  contract. It also asserts the corresponding planner/director refusal paths. Its report is
  intentionally rejected by `hve:gate` while HVE-G6 is scaffolded: it proves
  this bounded route is executable and has plan-level preview parity, not that
  automatic screen/gameplay direction is ready.
- `hve:verify:layout-director` is the separate promotion boundary for
  automatic HVE-6 direction. It requires a signed object index, independent
  annotation-set hash, versioned detector/director provenance, screen-presenter,
  gameplay-facecam and 3/4-person-panel strata, zero forbidden layouts,
  screen-preservation evidence and Timeweb CPU8/12GB no-swap measurements.
  The evaluator route now derives these values from evaluator-signed semantic
  labels plus signed candidate region mappings rather than accepting opaque
  metric fields: it calculates per-role recall, layout accuracy, forbidden
  decisions, preservation loss, transition p95 and resources. It signs the
  resulting benchmark too, and the promotion verifier requires the evaluator
  public key; a hand-written report cannot become automatic-layout evidence.
  Each stratum needs at least 24 independently sourced items and 120
  independently labelled ranges before threshold comparison.
  `hve:smoke:g6` returns `INSUFFICIENT` without this evidence rather than
  allowing executable manual composition to masquerade as an evaluated
  detector.
- The control API is default-deny for automatic layout advice via
  `HVE_AUTOMATIC_LAYOUT_DIRECTOR_ENABLED=false`. Enabling that flag is an
  explicit release operation after the exact deployed release has passed the
  signed HVE-G6 corpus and benchmark review; it does not control manually
  selected composites.
- The verification scaffold now has a real evaluator boundary: `hve:corpus:index`
  streams Timeweb S3 objects with evaluator-only credentials, binds their
  byte-level hashes to the exact ready manifest, and signs the resulting index
  with Ed25519. This protects the later G6 corpus/region evidence from a
  substituted object, annotation or license record. It does not create a
  screen/gameplay corpus or change G6 from `scaffold`.
- The evaluator now also has an executable **baseline candidate**, deliberately
  outside the worker: pinned MediaPipe face candidates plus explainable OpenCV
  structural rectangles and topology-only direction emit opaque regions,
  temporal decisions, provenance and cgroup measurements. A separate builder
  rejects substituted artifacts, unbound mappings, mixed provenance, host-only
  resources and below-target hardware before creating the signed prediction
  input. This creates a measurable starting point for model selection; it is
  not a screen/gameplay classifier, does not process customer media and does
  not change the automatic-layout default deny.

Work:

- screen/slide/gameplay/facecam region detector;
- automatic 3 and 4-person panel assignment (manual verified grids are now
  executable, automatic role selection is not);
- screen-presenter, gameplay 30/70, screen-only and panel policies;
- region role assignment and important-screen preservation;
- layout transitions across scene changes;
- inspector selection of participants/regions.

Gate: every corresponding corpus stratum passes region, layout, crop and stability thresholds; forbidden layouts = 0.

## HVE-7 — scalable scheduling and recovery

Goal: safe concurrent service on the current hardware and horizontal scale later.

Work:

- tune capability-aware claims and resource envelopes using production measurements;
- stage slots and bounded FFmpeg threads;
- weighted fairness, age boost and cancellation;
- checkpoint artifacts and reconciler;
- benchmark-backed ETA model;
- fairness and load simulation;
- admin quality/resource views.

Gate: no OOM/swap, peak RSS/scratch limits, fairness >= threshold, no starvation, ETA coverage and worker-kill recovery.

### Iteration status — evidence-only execution ETA (implemented, internal)

- the API records worker wall-time telemetry per attempt and can derive a
  cost-normalized p10/p50/p90 **execution** range only after at least six matching
  job-type samples, or twelve samples in the same resource class;
- the endpoint deliberately returns no queue-start prediction. Weighted fair
  scheduling and age boosts make a static queue position false precision until
  a benchmarked queue model exists;
- no current UI consumes this endpoint. A later progress screen may present the
  p10–p90 range (with p50 as its central estimate) only when it receives
  `estimated`, otherwise it must explain that the
  system is collecting timing evidence.

### Iteration status — class-aware worker admission (implemented, internal)

- job claim now serializes claims per worker lease, reads the worker's active
  jobs grouped by class, and admits a candidate only when both global and
  class-specific slots are available;
- a future worker with `maxConcurrentJobs > 1` therefore cannot accidentally
  run two `cpu_heavy` jobs just because its total count is below the global
  limit; it may take a compatible medium job when its declared medium slot is
  free;
- capability, workspace and class admission are isolated in a pure tested
  selector, while PostgreSQL remains the source of ordering and row-lock
  semantics. This is not yet a load-test or fairness gate pass.

### Iteration status — persistent weighted dispatch (implemented, internal)

- a claim now considers only the queued head of each workspace, advances a
  transaction-locked virtual finish by `estimatedCost / queueWeight`, and uses
  that state for the next dispatch; this prevents a high-volume clip series
  from winning merely because it has more queued rows;
- a separate globally locked dispatch state limits a workspace to two
  consecutive eligible claims when another runnable workspace is present;
- this is an implementation and pure-policy test only. The HVE-G7 fairness
  gate remains `INSUFFICIENT` until the real PostgreSQL, multi-worker and
  two-hour load scenario is measured on the target worker image.

### Iteration status — cgroup-aware worker resource admission (implemented, internal)

- before a CPU job starts, the worker evaluates both host-visible available
  memory and finite cgroup-v2 headroom, using the stricter value; this prevents
  a container from advertising host RAM and then being OOM-killed by its own
  memory limit;
- worker registration publishes the finite cgroup limit as `memoryBytes` when
  present, while retaining host RAM only as diagnostic metadata. The scheduler
  therefore does not admit an HVE plan on memory the container cannot use;
- FFmpeg decode, filtergraph and encoder worker counts are configurable but
  clamped to 1–8 per invocation. The deployed 12 GB worker defaults to four,
  so a future change to a non-serial worker cannot silently turn one render
  into unbounded CPU contention;
- a lease conflict from the control API sets a cancellation token on the
  active worker attempt. FFmpeg descendants run in their own process group and
  are terminated by that token; a cancelled attempt does not call `complete`
  or overwrite a newer lease. Python model/provider work observes cancellation
  at stage boundaries, so it may finish its current non-interruptible call but
  cannot publish a stale result;
- HVE-G7 now executes a real nested-process cancellation fixture: the parent
  spawns a child, loses its lease, and the test verifies that the isolated
  process group leaves neither process alive. This is distinct from database
  lease requeue evidence; both are necessary to reclaim the queue slot and
  the worker's CPU/scratch safely;
- this is an admission guard, not proof of a safe production envelope. RSS,
  scratch and swap limits still require the corpus and load evidence specified
  by HVE-G7.

### Iteration status — reproducible worker sample (implemented, internal)

- `npm run hve:benchmark` runs a bounded, non-customer FFmpeg fixture inside
  the worker runtime and emits CPU/cgroup RAM/scratch/FFmpeg facts plus an
  actual 1080×1920 render realtime factor;
- its report is a candidate baseline input only. It deliberately cannot turn
  HVE-G7 active: queue fairness, real STT/vision resource usage, recovery and
  licensed corpus work remain independently required;
- three matching benchmark reports are now converted into an evaluator-signed
  candidate baseline. Comparison accepts only an independently approved,
  signature-valid baseline with the same OCI image, FFmpeg build, finite
  cgroup CPU quota and memory envelope, and fixture; the privileged benchmark
  command refuses to collect a sample before the worker is drained and idle;
  a local smoke or manually edited JSON is never ETA evidence;
- operating procedure: `docs/operations/hve-worker-benchmark.md`.

### Iteration status — worker drain and runtime identity (implemented, internal)

- an operator can enable a local, durable worker drain marker; the worker
  advertises `draining`, stops claiming new jobs and finishes its active
  attempt without cancelling customer work;
- the PostgreSQL claim path refuses a worker whose latest registration says it
  is draining, so a delayed/direct claim cannot defeat maintenance mode;
- active-job state is local operational telemetry only and is atomically
  replaced/cleared. Worker startup removes a stale marker after a process
  restart rather than reporting a phantom running customer job;
- production deploy checks the health status, active immutable OCI image
  digest and model-readiness from inside the live non-root container. It is
  not a benchmark or a quality gate pass; benchmark evidence still requires
  three drained, target-worker 60-second samples and independent approval.
- worker registration now derives a non-secret runtime fingerprint from that
  pinned OCI digest, engine/model/font versions and enforced cgroup envelope;
  every successful attempt carries the same value. ETA accepts historical
  timing only when it matches one fresh non-draining active runtime. A rolling
  deploy, unknown image digest or mixed worker fleet intentionally returns
  insufficient evidence instead of blending incomparable throughput.

## HVE-8 — B-roll, music and advanced production

Goal: add powerful bounded production layers without turning HVE into an NLE.

### Iteration status — verified user-supplied visual replacement (implemented, internal)

- a worker-verified `broll` MP4 can only replace the whole visual canvas over
  one bounded, non-overlapping output-clock range; it cannot loop, cannot
  contribute audio and preserves the existing narrative audio time map;
- the shared browser projection now exposes that active B-roll layer from the
  immutable resolved plan (asset identity, timing and full-canvas geometry),
  but it intentionally does not claim a browser player or frame parity;
- planner, worker and FFmpeg compositor all repeat the restrictive policy;
  invalid geometry, transparency, an audible B-roll request, a short asset or
  overlap fails before a version is rendered;
- `npm run hve:smoke:g8` records synthetic policy, asset verification and
  pixel/audio evidence, but returns `INSUFFICIENT` by design. It cannot become
  a public release gate until user controls/preview parity, a cost ledger,
  music policy and a licensed corpus exist.

Work:

- B-roll items with source, timing, replace/delete/disable;
- uploaded asset path is free, generation is separately metered;
- music layer, ducking and rights metadata;
- optional filler-word removal/noise cleanup adapters;
- bulk apply and project/style scopes;
- optional licensed Remotion overlay adapter only if ADR reconsideration gates pass.

Gate: layer collision/time-map/media validation, cost idempotency and user control of every generated insert.

## HVE-9 — production release and market proof

Goal: canary the complete engine and verify the market claim.

Work:

- sealed holdout and stress runs;
- blind comparison against OpusClip/Reels Boss/manual reference;
- shadow analysis on eligible projects;
- staged rollout and automatic rollback;
- runbooks for model, engine, queue and storage incidents;
- support/admin explanations for fallbacks and failed stages.

Gate: all production and market gates in `hve-verification.md` pass with signed report artifacts.

### Iteration status — sealed release verifier (implemented, intentionally blocked)

- `npm run hve:verify:release` consumes only evaluator-signed release
  evidence. It cryptographically binds the immutable candidate Git SHA and
  OCI image digest, report bytes, sealed corpus facts, per-stratum results,
  frozen quality limits, FFmpeg/model provenance, the approved Timeweb
  baseline comparison and quantitative blinded-market-study limits.
- It distinguishes `FAIL` (tampered/mismatched artifact or measured quality
  regression) from `INSUFFICIENT` (missing corpus stratum, missing suite,
  missing baseline or scaffold threshold). Neither may be converted into a
  release pass.
- `production-v1.json` remains intentionally scaffolded. Activating it is a
  governance action after development-corpus calibration and independent
  review, not a code change made by an implementation agent.
- The separate evaluator-only `hve:assemble:release` command reads the exact
  artifact bytes, confirms runtime provenance against the immutable candidate,
  and signs the envelope with `HVE_RELEASE_EVALUATOR_PRIVATE_KEY_FILE`. The
  application/worker/CI side can only run the public-key verifier.
- The operator sequence, role separation and rollback criteria are recorded in
  `docs/operations/hve-sealed-release.md`; a deploy itself is not approval.

## First implementation batch for Terra

Terra should start with HVE-0 and HVE-1, not computer vision. The first concrete batch is:

1. Add v2 contract files and canonical hash tests.
2. Add DB migrations for engine releases, source analyses, artifacts, plans, drafts and scheduler requirements.
3. Add v1 adapter and roundtrip fixtures.
4. Introduce `services/control-api/src/services/hve` repositories/orchestrator without replacing v1.
5. Add worker metrics and one actual FFmpeg smoke render.
6. Surface existing unimplemented behavior as warnings/locked UI.
7. Add minimum resource admission/capability matching before any v2 job can run.
8. Produce baseline report from the real Timeweb worker.

Only after that foundation should Terra implement HVE-2 time mapping and compositor work.

## Pull request evidence template

Every HVE PR description must state:

```text
Roadmap slice:
User capability:
Contracts/migrations:
Stages changed:
Fallback behavior:
Fixtures and strata:
Checks passed:
Peak RSS / RTF / scratch (if media-sensitive):
Preview/render parity (if editor/render-sensitive):
Known locked capabilities:
Rollback/compatibility:
```
