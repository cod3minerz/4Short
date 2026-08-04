---
name: hve-verification
description: Use when testing, benchmarking, reviewing, releasing, or making quality claims about HVE contracts, vision, active speaker, layouts, subtitles, renderer, editor parity, worker performance, queues, models, codecs, or dependencies. Routes each change to the required evidence gate and prevents unsupported production claims.
---

# HVE Verification

Read `docs/architecture/hve-verification.md`. A green unit suite alone is not evidence that media output, visual tracking, queue fairness or editor parity works.

## Route the change

- Contract/EDL/time map: `npm run hve:gate -- HVE-G1`.
- Renderer/subtitles/layers/audio: union of `HVE-G2` and `HVE-G3`.
- Editor/drafts: `HVE-G4` plus `HVE-G3` when preview geometry changes.
- Vision/diarization/active speaker/director: `HVE-G5`.
- Screen/gameplay/panels: `HVE-G6`.
- Queue/lease/slots/performance: `HVE-G7`.
- Model, FFmpeg or dependency version: relevant semantic gate plus `HVE-G7`.
- Release or “best/production-ready” claim: `HVE-G9` and every prerequisite gate.

When a change matches multiple entries, run the union. The registry is `verification/hve/gate-registry.json`. A scaffold or unimplemented gate must return `INSUFFICIENT` (exit 2), never PASS.

## Rules

1. State the corpus version, engine release, model hashes, renderer/FFmpeg build and hardware profile.
2. Report per-stratum metrics; an overall average cannot hide a failed stratum.
3. `INSUFFICIENT` sample size is not `PASS`.
4. Never update goldens and the generating algorithm as one automatic approval.
5. Never lower a threshold without an explicit, time-bounded rationale.
6. A failed candidate must not overwrite a baseline.
7. Store large/private media in private S3; Git contains manifests and hashes only.
8. Production user media is never silently added to the corpus.
9. Attach the required report artifacts before saying the feature is ready.
10. A `ready` corpus requires an evaluator-only streamed S3 index signed with
    Ed25519. Run `hve:corpus:index` only in that evaluator environment; verify
    it with `HVE_CORPUS_OBJECT_INDEX` and the evaluator public key. A JSON
    manifest or an unsigned index is never corpus evidence.

## Minimum PR evidence

Run unit/property checks and at least one actual media integration test for any media-path change. Include fixtures, warnings/fallbacks, peak RSS, realtime factor and scratch use when the change affects a worker stage.

For editor/render changes include planned geometry/timing comparison. For queue changes include multiple concurrent claimants and expired-lease behavior.

## Release evidence

A release candidate requires:

- `metrics.json` and `junit.xml`;
- human-readable `report.html`;
- failed-item list and contact sheets/heatmaps where visual;
- signed baseline comparison;
- pass/fail for every required stratum;
- chaos and rollback result.

If the verifier scaffolding for a required gate does not yet exist, implement that gate as part of the slice or report the capability as unverified. Do not replace it with an assertion.
