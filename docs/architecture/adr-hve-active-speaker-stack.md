# ADR: active-speaker evidence stack

**Status:** accepted for benchmark implementation; not approved for public
product release.

## Context

HVE must eventually keep the speaking person visible in a solo podcast,
interview, panel or screen-share clip. A face detector alone cannot establish
who speaks. Choosing the largest face or a face nearest the centre produces
plausible but false edits when somebody else is talking, the speaker is
off-screen or people overlap.

The production worker is limited to 8 vCPU / 12 GB RAM and runs one heavy media
job. The main Faster-Whisper pass remains the transcription source of truth.

## Decision

Build active-speaker in four independently versioned artifacts:

```text
Faster-Whisper + Silero VAD
  → anonymous diarized speaker turns
  → dense selected-clip face tracks + landmark mouth activity
  → deterministic audio/video association
  → confidence, visible fallback and director input
```

1. **Speech:** retain Faster-Whisper for words and use an evaluation-only
   Sherpa-ONNX offline diarization adapter (segmentation + embedding +
   clustering) as the first candidate. It is isolated from the base worker
   image until corpus evidence confirms its RAM, licence and Russian quality.
2. **Vision:** retain YuNet for cheap sparse source tracks. Evaluate MediaPipe
   Face Landmarker only on the dense selected-clip path to derive mouth-motion
   windows; its landmark/blendshape output is the needed evidence, not a proxy
   for identity.
3. **Association:** use `fourshort_worker.association` as the shared pure,
   deterministic scorer. It requires diarized turns, visible face coverage,
   mouth-motion contrast and a one-to-one assignment margin. It emits
   `insufficient_evidence` rather than guessing. `offscreen` is permitted only
   after a completed face-analysis pass found no visible face for the turn.
   Candidate adapters cross this boundary through
   `fourshort_worker.active_speaker_evidence`: two strict, compact JSON
   documents bind diarization and mouth windows to one source hash/duration,
   then produce a hash-bound artifact. They cannot pass raw audio, frames,
   face landmarks or embeddings into the control plane.
4. **Renderer/director:** consume only persisted `activeSpeakerLinks` and
   explicit confidence. The renderer cannot run models or decide speakers.

## Candidate comparison

| Component | Candidate | Role | Base image? |
|---|---|---|---|
| Diarization | Sherpa-ONNX offline diarization | candidate baseline | no, evaluation image first |
| Diarization | pyannote/WhisperX | quality comparator | no — PyTorch and peak RSS |
| Landmarks | MediaPipe Face Landmarker | candidate baseline | no, dense evaluation first |
| Visual ASD | Light-ASD ONNX export | later comparator | no — only if it beats baseline |

The candidates were selected from their official capabilities: Sherpa-ONNX
supports offline diarization with segmentation, embeddings and clustering;
MediaPipe Face Landmarker exposes video landmarks and blendshape coefficients;
Faster-Whisper supports word timestamps and Silero VAD. The published results
are not HVE evidence. Sources: [Sherpa-ONNX diarization](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html),
[MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/python),
[Faster-Whisper](https://github.com/SYSTRAN/faster-whisper).

## Acceptance gates

The benchmark corpus is private and versioned. A candidate may enter the base
worker only after HVE-G5 passes **every** applicable stratum:

- clean two-person active-speaker F1 at least 0.92;
- panel/hard F1 at least 0.85;
- off-screen false assignment no more than 2%;
- p95 speaker-switch latency no more than 600 ms;
- p95 dense-analysis RSS within 9 GB and no sustained swap on Timeweb CPU8/12GB;
- a visible fallback for all insufficient-confidence ranges.

The evaluator writes candidate/model hashes, cold-start time, realtime factor,
RSS, source licensing and per-stratum failure samples. A failed candidate can
never overwrite the current fallback baseline.

### Evaluator image boundary

The first executable candidate lives in `services/hve-evaluator`, not in the
media-worker image. It pins Sherpa-ONNX `1.13.4` and MediaPipe `0.10.18` for
the Python 3.12 Linux evaluator ABI, verifies a local three-file model manifest
before inference, and emits only the bounded candidate evidence consumed by
`fourshort_worker.active_speaker_evidence`. The image has no customer Control
API/S3 credentials and is invoked only against evaluator-controlled corpus
objects. The model files are deliberately not downloaded during Docker build:
their upstream license and redistribution terms must be reviewed, and their
source URL/version/SHA-256 recorded in the evaluator manifest before a run.

Candidate folders are consumed only by an evaluator-side prediction-bundle
builder. It verifies every source and compact-evidence hash, the verified model
manifest fingerprint, association-code hash and sealed evaluator mapping before
writing the unsigned predictions accepted by the Ed25519 signer. It refuses
process-only telemetry: promotion evidence must contain cgroup-v2 peak-memory
and swap values from the `timeweb-cpu8-12gb` evaluator. Neither a worker nor a
product credential can create a signed benchmark result.

This implementation makes the candidate measurable; it is not a decision to
ship Sherpa/MediaPipe in the standard worker or to expose automatic tracking.
Promotion still requires the signed HVE-G5 corpus report.

## Consequences

The current public capability remains **manual crop / verified face track**;
it must not be labelled active-speaker tracking. This ADR provides an
implementation boundary, executable candidate-evidence contract and objective
promotion criteria, while keeping both model dependencies out of ordinary
project jobs.
