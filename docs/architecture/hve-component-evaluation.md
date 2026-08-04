# HVE component evaluation and adoption policy

The goal is not to maximize dependencies. Adopt a component only when it improves HVE’s own corpus and fits the CPU worker, license and operational model.

## Selected baseline

| Capability | Baseline | Status | Why |
|---|---|---|---|
| STT | Faster-Whisper + Large V3 Turbo, CPU int8 | selected | CTranslate2, word timestamps, VAD, low-memory CPU path |
| Speech activity | Silero VAD | selected | lightweight and already integrated via Faster-Whisper path |
| Scene cuts | PySceneDetect algorithms on proxy | evaluate/adopt | mature content/adaptive detection, cheap CPU stage |
| Face detect | YuNet sparse detection | current baseline | tiny CPU footprint; adequate bootstrap |
| Face tracking | motion-aware tracker inspired by ByteTrack | build/evaluate | current greedy IoU is insufficient; avoid heavy re-ID by default |
| Active speaker | turns + mouth motion, optional Light-ASD | build/evaluate | staged CPU approach with confidence/fallback |
| Layout | HVE scene graph + director | build | core product IP and content-specific policies |
| Subtitles | custom planner + ASS/libass | selected | deterministic, fast and production-proven rendering path |
| Compositor | native FFmpeg | selected | lowest operational cost on CPU worker |
| Browser preview | native video + DOM/SVG + Canvas/WebGL | selected | immediate editing without browser encoding |
| Final render | FFmpeg/libass | selected | deterministic A/V and restartable clip jobs |

Faster-Whisper’s official repository documents CTranslate2, CPU int8, word timestamps and integrated Silero VAD, and reports much lower CPU time/memory than the original implementation under comparable settings. It is therefore the correct default rather than SpeechKit. [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper).

## Speech alternatives

### WhisperX

Useful for forced alignment and optional diarization. Do not install it in the base CPU image yet: it brings PyTorch/alignment model dependencies and language-specific behavior. Introduce it as a separate capability/image only if Russian word-timing p95 improves enough to justify peak RSS and image size. [WhisperX](https://github.com/m-bain/whisperX).

### whisper.cpp

Strong CPU alternative and potential emergency/edge adapter. It should be benchmarked with identical model, beam, threads and WER settings. It is not selected immediately because the current pipeline already uses Faster-Whisper word structures and adapters.

### External STT APIs

Keep provider adapters for burst capacity or temporary fallback, but do not make Russian user content leave the selected data contour silently. Provider use requires availability, cost, legal and quality policy per workspace.

## Vision and speaker alternatives

### Face detection

- YuNet: keep as the low-resource baseline.
- MediaPipe: evaluate for landmarks/mouth-motion where licensing and platform fit are acceptable.
- YOLO-family face detectors: only if hard-corpus recall gain justifies model size and CPU cost.

### Tracking

- Current greedy IoU: prototype only.
- ByteTrack-style motion/association: preferred design reference for sparse detections.
- DeepSORT/re-ID: optional for long occlusions; not default because embeddings increase CPU and identity/privacy surface.

### Active speaker

- Heuristic mouth motion + speaker turns: first production baseline with calibrated confidence.
- Light-ASD: promising lightweight research implementation; must be exported/isolated and measured on HVE corpus before adoption. [Light-ASD](https://github.com/Junhua-Liao/Light-ASD).
- TalkNet/heavier audiovisual models: research comparator, not base-worker dependency.

No model’s published benchmark substitutes for HVE’s Russian podcasts, panels and streams.

The baseline diarization-embedding and facial-landmark implementations are intentionally not selected by name yet. The first candidate is now executable only inside `services/hve-evaluator`: Sherpa-ONNX `1.13.4` provides offline segmentation/embedding/clustering and MediaPipe `0.10.18` provides video-mode landmarks/mouth motion. This is a comparison harness, not a production selection. HVE-5 may not promote it until the HVE corpus measures Russian diarization error, mouth-association F1, peak RSS, cold start, model license and redistribution terms against another commercially usable CPU candidate. Until that ADR passes, the corresponding capability remains experimental and cannot be advertised as production active-speaker tracking.

## Scene and screen understanding

PySceneDetect is selected for shot boundaries, not semantic direction. HVE still owns screen/facecam/important-region detection and scene classification. [PySceneDetect](https://github.com/Breakthrough/PySceneDetect).

Begin with explainable CPU features on proxy frames:

- stable large rectangles and border lines;
- scene-change rate inside candidate screen region;
- face area relative to source;
- text/edge density;
- motion distribution;
- known grid patterns.

Train or add a model only for strata where this baseline fails measurably.

The first executable implementation of that baseline now lives only in the
separate HVE evaluator. It uses the pinned MediaPipe face candidate plus
OpenCV rectangle/edge candidates and a topology-only director, outputs opaque
region IDs and signed-evidence-ready prediction artifacts, and is documented
in [hve-layout-evaluator.md](../operations/hve-layout-evaluator.md). It does
not label a rectangle as a screen, infer active speaker, enter the
media-worker, or alter a product render. The G6 evaluator maps opaque IDs to
sealed labels and decides whether this baseline is worth replacing with a
model.

## Editor/render alternatives

### Remotion

Keep as a future complex-overlay adapter only. It is not the standard preview or final renderer for reasons recorded in `adr-hve-rendering-stack.md`.

### OpenCut and timeline packages

Use as implementation references for snapping, selection and WASM boundaries. Do not depend on their universal project/timeline schema. HVE’s bounded narrative/layout/production layers are a deliberate product advantage. [OpenCut](https://github.com/OpenCut-app/OpenCut).

### WebCodecs and Mediabunny

WebCodecs is an optional enhanced browser path; Mediabunny is the preferred parser candidate if frame-accurate demux is needed. Both require fallback and memory tests. They never replace server rendering.

## Adoption gate

Before a new library/model enters production, record:

1. exact version/commit and SHA-256 of weights;
2. code and model license, redistribution and commercial terms;
3. image-size and cold-start delta;
4. peak RSS, CPU seconds, RTF and scratch delta on Timeweb worker;
5. corpus improvement overall and in worst strata;
6. deterministic/offline behavior and failure mode;
7. security/maintenance history;
8. removal/rollback path.

Adopt only when the quality gain is material and no required resource/reliability gate regresses. Otherwise keep the component behind an experimental capability flag or reject it.
