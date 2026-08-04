# HVE v2 contracts and persistence

This document is the authoritative domain boundary for Terra. TypeScript/Zod contracts in `packages/contracts` must be created from these shapes before worker or editor implementations.

## 1. Time and coordinates

- All persisted media time is integer microseconds: `TimeUs`.
- Intervals are half-open: `[startUs, endUs)`.
- `timebase.ticksPerSecond` is fixed to `1_000_000`; one persisted tick is one microsecond.
- Frame rate is rational `{ numerator, denominator }`, for example `30000/1001`. Container PTS/timebase remains source metadata and is converted explicitly.
- Normalized rectangles use display-oriented source coordinates after rotation: `{ x, y, width, height }` in `[0, 1]`.
- Canvas geometry uses integer pixels at the target export resolution.

Do not reuse the v1 floating-point editor state as a persisted format.

## 2. Analysis manifests

```ts
type ArtifactRef = {
  artifactId: string;
  kind: string;
  schemaVersion: number;
  engineVersion: string;
  modelVersion?: string;
  objectKey: string;
  sha256: string;
  byteSize: number;
};

type ArtifactSliceRef = {
  artifact: ArtifactRef;
  coverage: TimeRangeUs[];
  density: "sparse" | "dense";
  supersedes?: string[];
};

type SourceAnalysisManifest = {
  schemaVersion: 1;
  analysisId: string;
  sourceId: string;
  sourceHash: string;
  media: MediaFacts;
  artifacts: {
    speech?: ArtifactRef;
    scenes?: ArtifactRef;
    regions?: ArtifactSliceRef[];
    faces?: ArtifactSliceRef[];
    speakers?: ArtifactSliceRef[];
    associations?: ArtifactSliceRef[];
    classification?: ArtifactSliceRef[];
    thumbnails?: ArtifactRef;
    waveform?: ArtifactRef;
  };
  warnings: EngineWarning[];
  completedAt: string;
};
```

Dense observations remain in S3. The database never stores one row per frame.

## 3. Scene graph

```ts
type SceneGraph = {
  schemaVersion: 1;
  sourceId: string;
  shots: Shot[];
  regions: RegionTrack[];
  faces: FaceTrack[];
  speakerTurns: SpeakerTurn[];
  activeSpeakerLinks: ActiveSpeakerLink[];
  classifications: SceneClassification[];
};

type SceneClassification = {
  range: TimeRangeUs;
  probabilities: Partial<Record<ContentType, number>>;
  evidence: string[];
};

type ContentType =
  | "solo" | "conversation" | "panel" | "remote_grid"
  | "screen_speaker" | "screen_only"
  | "gameplay_facecam" | "gameplay_only"
  | "vertical_source" | "slides" | "mixed" | "unknown";
```

Tracks contain sparse keyframes and confidence. IDs are stable only inside one analysis version; persisted user locks refer to analysis ID plus track ID.

## 4. Editable ClipDocumentV2

`ClipDocumentV2` is the only editable source of truth.

```ts
type ClipDocumentV2 = {
  schemaVersion: 2;
  clipId: string;
  sourceRefs: SourceRef[];
  timebase: {
    ticksPerSecond: 1_000_000;
    frameRate: { numerator: number; denominator: number };
  };
  narrative: NarrativeSegment[];
  layout: LayoutSegment[];
  captions: CaptionTrack;
  layers: ProductionLayer[];
  audio: AudioPolicy;
  export: ExportProfile;
  styleVersionId: string;
  analysisId: string;
  plannerVersion: string;
  rendererVersion: string;
};

type NarrativeSegment = {
  id: string;
  sourceId: string;
  sourceRange: TimeRangeUs;
  enabled: boolean;
  order: number;
  transcriptWordIds: string[];
  transitionIn?: Transition;
  transitionOut?: Transition;
};

type LayoutSegment = {
  id: string;
  anchor: SegmentAnchorRange;
  template: LayoutTemplateId;
  slots: SlotAssignment[];
  provenance: DecisionProvenance;
  lockedByUser: boolean;
};

type SegmentAnchor =
  | { kind: "narrative_offset"; narrativeSegmentId: string; offsetUs: number }
  | { kind: "source_word"; wordId: string; edge: "start" | "end" }
  | { kind: "clip_start" }
  | { kind: "clip_end"; offsetUs: number };

type SegmentAnchorRange = { start: SegmentAnchor; end: SegmentAnchor };

type SlotAssignment = {
  slotId: string;
  regionRef: RegionRef;
  fit: "cover" | "contain" | "smart_cover";
  cropTrack?: CropTrackRef;
  manualCrop?: NormalizedRect;
};
```

Layout templates are registry IDs. The document may contain resolved overrides, but product behavior is not encoded by arbitrary FFmpeg strings.

### Production layers

```ts
type ProductionLayer =
  | TextLayer
  | ImageLayer
  | VideoLayer
  | LogoLayer
  | BannerLayer
  | BrollLayer
  | OutroLayer;

type LayerBase = {
  id: string;
  anchorRange: SegmentAnchorRange;
  followPolicy: "follow_narrative" | "absolute_output" | "clip_end" | "source_word";
  zIndex: number;
  anchor: Anchor;
  box: NormalizedRect;
  opacity: number;
  collisionPolicy: "move" | "shrink" | "warn" | "allow";
};
```

V2 initially exposes one title, one logo, one banner, one outro and bounded B-roll items in the UI, while the internal model remains extensible.

### Captions

The editable document stores word references, overrides and style. Cue grouping, output timing and line breaks exist only in `ResolvedRenderPlan`, so narrative edits do not rewrite the entire draft.

```ts
type CaptionTrack = {
  enabled: boolean;
  language: string;
  words: Array<{
    wordId: string;
    displayText?: string;
    hidden: boolean;
    speakerOverride?: string;
  }>;
  style: CaptionStyle;
};
```

### Audio and time mapping

```ts
type AudioPolicy = {
  sourceCuts: Array<{
    sourceId: string;
    sourceRange: TimeRangeUs;
    reason: "user" | "pause" | "filler";
  }>;
  pauseRemoval: {
    enabled: boolean;
    minimumUs: number;
    beforePaddingUs: number;
    afterPaddingUs: number;
    crossfadeUs: number;
  };
  loudness: { targetLufs: number; truePeakDb: number };
  music?: AudioLayer;
};

type TimeMap = Array<{
  sourceRange: TimeRangeUs;
  outputRange: TimeRangeUs;
  sourceId: string;
  rate: { numerator: number; denominator: number };
}>;
```

The planner produces one monotonic `TimeMap` used by video, audio, captions, layers and the editor playhead.

## 5. ResolvedRenderPlan

The planner produces an immutable render artifact. Both browser preview and FFmpeg compile from it.

```ts
type ResolvedRenderPlan = {
  schemaVersion: 1;
  documentHash: string;
  canvas: { width: number; height: number; fps: number };
  timeMap: TimeMap;
  layoutSegments: Array<{
    outputRange: TimeRangeUs;
    slots: Array<{
      destinationPx: RectPx;
      source: RegionRef;
      cropKeyframes: CropKeyframeUs[];
      cornerRadiusPx: number;
      background?: ResolvedBackground;
    }>;
    transition?: ResolvedTransition;
  }>;
  captionPlan: ResolvedCaptionPlan;
  layerPlan: ResolvedLayer[];
  audioPlan: ResolvedAudioPlan;
  warnings: EngineWarning[];
  dependencies: ArtifactRef[];
};
```

`pauseRemoval.crossfadeUs` is not a renderer hint. For each executable
pause-only transition the planner writes the *applied* duration into the
incoming `TimeMapEntry.transitionInUs` (maximum 500 ms and strictly shorter
than both adjacent retained ranges). Its output range overlaps the preceding
entry by exactly that value. This is the only supported representation of a
crossfade: video, audio, captions, layout timing and final duration consume
the same output clock. User and transcript cuts never receive a transition.

No model inference is allowed after this boundary.

### Planner runtime

Implement deterministic geometry/time/caption planning in a browser-safe pure TypeScript package:

```text
packages/hve-planner-core/
  normalize | time-map | layout-registry | geometry
  captions | collisions | layers | canonicalize
```

The package has no database, network, React or Node-only dependencies. Control API/plan workers create the authoritative plan with verified artifacts; the browser runs the same functions provisionally for sub-50 ms local feedback using the manifest it already owns. The server response reconciles by document hash and planner version. A disagreement is a parity error, not an alternative acceptable plan.

Automatic multimodal direction remains a worker stage and writes layout decisions into `ClipDocumentV2`; `hve-planner-core` only resolves deterministic timing and geometry.

## 6. Decisions, fallbacks and locks

```ts
type DecisionProvenance = {
  origin: "engine" | "style" | "project" | "user";
  reasonCode: string;
  confidence?: number;
  alternatives?: Array<{ template: LayoutTemplateId; score: number }>;
  engineVersion?: string;
};

type EngineWarning = {
  code: string;
  range?: TimeRangeUs;
  requested?: string;
  applied?: string;
  userMessage: string;
  severity: "info" | "warning" | "error";
};
```

Unknown or impossible requests must produce warnings. Silent fallback is prohibited.

## 7. Drafts, commands and versions

```ts
type ClipDraftV2 = {
  clipId: string;
  baseVersion: number;
  revision: number;
  document: ClipDocumentV2;
  updatedAt: string;
  updatedBy: string;
};

type EditorCommandBase = {
  commandId: string;
  batchId: string;
  clipId: string;
  clientId: string;
  clientSequence: number;
  baseRevision: number;
  createdAt: string;
};

type EditorCommand = EditorCommandBase & (
  | { kind: "replace_word"; wordId: string; displayText: string }
  | { kind: "set_word_visibility"; wordIds: string[]; hidden: boolean }
  | { kind: "cut_words"; wordIds: string[]; cut: boolean }
  | { kind: "trim_narrative"; segmentId: string; sourceRange: TimeRangeUs }
  | { kind: "split_narrative"; segmentId: string; at: SegmentAnchor }
  | { kind: "reorder_narrative"; orderedSegmentIds: string[] }
  | { kind: "set_layout"; anchor: SegmentAnchorRange; template: LayoutTemplateId; slots?: SlotAssignment[] }
  | { kind: "set_layout_lock"; layoutSegmentId: string; locked: boolean }
  | { kind: "set_manual_crop"; layoutSegmentId: string; slotId: string; crop: NormalizedRect | null }
  | { kind: "add_layer"; layer: ProductionLayer }
  | { kind: "update_layer"; layerId: string; patch: ProductionLayerPatch }
  | { kind: "remove_layer"; layerId: string }
  | { kind: "set_caption_style"; patch: CaptionStylePatch }
  | { kind: "set_audio_policy"; patch: AudioPolicyPatch }
  | { kind: "set_export_profile"; profile: ExportProfile }
);

type CommandResult = {
  commandId: string;
  status: "applied" | "duplicate" | "rejected";
  revision: number;
  normalizedPatch?: unknown;
  error?: { code: string; path?: string; message: string };
};
```

- Autosave accepts a batch of commands with optimistic concurrency.
- `commandId` is idempotent inside the clip; repeated offline delivery returns `duplicate` and cannot apply twice.
- Commands use a strict discriminated Zod union. `payload: unknown` is prohibited at the domain boundary.
- The server validates, normalizes, returns a `CommandResult` per command and increments `revision` once per accepted batch.
- Periodic snapshots bound replay time; command batches enable undo/audit.
- Client undo normally emits the inverse typed command. Destructive/reorder commands store the normalized pre-image needed to construct that inverse.
- Commit checks `baseVersion`, creates immutable `ClipVersionV2` and an outbox `plan.requested` event in one short PostgreSQL transaction.
- Planning reads S3 artifacts outside the commit transaction. A successful immutable plan emits `render.requested`; render begins only when explicitly requested by the commit-and-render command.
- A render job references a version and plan hash, never a mutable draft.

## 8. PostgreSQL additions

Add through migrations:

- `source_analyses`: source, engine release, status, manifest and hash;
- `analysis_artifacts`: manifest rows for S3 objects;
- `layout_plans`: document hash, planner version, plan artifact, warnings;
- `clip_drafts`: one current server draft per clip/workspace;
- `editor_command_batches`: bounded audit/recovery log;
- `engine_releases`: engine/schema/model/renderer version bundle;
- `model_artifacts`: name, hash, license, compatibility;
- `quality_reports`: suite/status/metrics/report artifact;
- `benchmark_runs`: hardware profile, stage metrics and baseline comparison.

Keep `clip_versions` for immutable versions; add v2 document/plan references without destroying v1 records.

## 9. API surface

```text
GET    /v1/clips/:clipId/draft
PATCH  /v1/clips/:clipId/draft          If-Match: draft revision
POST   /v1/clips/:clipId/draft/commit   immutable version only, Idempotency-Key
POST   /v1/clips/:clipId/draft/commit-and-render
GET    /v1/clips/:clipId/editor-manifest
POST   /v1/clip-versions/:versionId/render
GET    /v1/clips/:clipId/preview-plan
GET    /v1/projects/:projectId/analysis
POST   /v1/projects/:projectId/analysis/ranges
GET    /v1/engine/capabilities
```

`editor-manifest` returns proxy metadata and refreshable signed Range URL, transcript reference, waveform peaks, thumbnail index, asset/font manifests, current draft/version, `ResolvedRenderPlan` and capabilities. It never returns the original object credentials. The URL contract includes `Accept-Ranges`, explicit CORS/MIME/cache headers, expiry timestamp and a refresh operation after/shortly before `403` or expiry.

Commit flow is fixed:

```text
draft commit transaction -> ClipVersionV2 + outbox plan.requested
planner job               -> immutable ResolvedRenderPlan + outbox render.requested
render job                -> verified artifact
```

Plain `commit` stops after the version/plan is ready. `commit-and-render` records render intent idempotently; it does not execute planning inside the database transaction. A separate render endpoint accepts only an immutable version and deduplicates by version/plan hash.

Conflict responses include server revision/version, rejected command IDs and a safe reload/rebase/copy action. Full transcript text, source URLs and signed URLs are never included in analytics.

## 10. Versioning and compatibility

- Keep Zod schemas by explicit version; never change meaning under one version.
- Provide `v1 -> v2` import for existing clips with one layout segment.
- New features can require a minimum planner/renderer version.
- Engine release pins contract, model, FFmpeg, font package and planner versions.
- Canonical serialization sorts object keys and only field-whitelisted unordered sets (for example safe-zone IDs). Narrative segments, time maps, layouts, keyframes, caption words/cues, layers and transitions always preserve order. Generic recursive array sorting is forbidden.
- Unknown future fields are rejected on write and preserved only by explicitly forward-compatible readers.

Database rollout follows expand -> dual read -> backfill -> feature-flagged v2 -> shadow validation -> cutover -> later contract cleanup. No destructive migration and code cutover occur in one deployment.
