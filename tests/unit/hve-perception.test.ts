import assert from "node:assert/strict";
import test from "node:test";
import {
  faceTracksCoveringSourceRange,
  hveActiveSpeakerArtifactSchema,
  hveSceneGraphSchema,
} from "../../packages/contracts/src/index.js";

const ids = {
  source: "11111111-1111-4111-8111-111111111111",
};

function graph() {
  return {
    schemaVersion: 1 as const,
    sourceId: ids.source,
    sourceHash: "a".repeat(64),
    engineVersion: "hve-vision-1",
    generatedAt: "2026-08-03T00:00:00.000Z",
    durationUs: 10_000_000,
    shots: [{ id: "shot-0", range: { startUs: 0, endUs: 10_000_000 }, confidence: 0.8, reason: "histogram_cut" as const }],
    regions: [{
      id: "face-1",
      kind: "face" as const,
      range: { startUs: 0, endUs: 10_000_000 },
      keyframes: [
        { atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.9 },
        { atUs: 500_000, box: { x: 0.15, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.9 },
      ],
      confidence: 0.9,
      provenance: { detector: "yunet", modelVersion: "2023mar-int8" },
    }],
    speakerTurns: [],
    activeSpeakerLinks: [],
    classifications: [{ range: { startUs: 0, endUs: 10_000_000 }, probabilities: { solo: 0.8, unknown: 0.2 }, evidence: ["one_persistent_face"] }],
    warnings: [],
  };
}

test("HVE perception artifact stores sparse facts, not frames", () => {
  assert.equal(hveSceneGraphSchema.safeParse(graph()).success, true);
});

test("perception artifacts reject non-monotonic or out-of-range keyframes", () => {
  const malformed = graph();
  malformed.regions[0]!.keyframes = [
    { atUs: 500_000, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.9 },
    { atUs: 100_000, box: { x: 0.15, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.9 },
  ];
  assert.equal(hveSceneGraphSchema.safeParse(malformed).success, false);
});

test("editor participant summary exposes only face tracks with complete source-clock coverage", () => {
  const sourceGraph = graph();
  sourceGraph.regions.push({
    id: "face-full", kind: "face", range: { startUs: 0, endUs: 10_000_000 }, confidence: 0.88,
    keyframes: [
      { atUs: 0, box: { x: 0.35, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.88 },
      { atUs: 9_999_999, box: { x: 0.35, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.88 },
    ],
    provenance: { detector: "yunet", modelVersion: "2023mar-int8" },
  });
  sourceGraph.regions.push({
    id: "face-short", kind: "face", range: { startUs: 0, endUs: 6_000_000 }, confidence: 0.99,
    keyframes: [
      { atUs: 0, box: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.99 },
      { atUs: 5_999_999, box: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.99 },
    ],
    provenance: { detector: "yunet", modelVersion: "2023mar-int8" },
  });
  assert.deepEqual(faceTracksCoveringSourceRange(hveSceneGraphSchema.parse(sourceGraph), {
    startUs: 0,
    endUs: 10_000_000,
  }), [{
    trackId: "face-full",
    confidence: 0.88,
    sourceRange: { startUs: 0, endUs: 10_000_000 },
    keyframeCount: 2,
  }]);
});

test("HVE active-speaker artifact is bounded evidence, not a loose tracking claim", () => {
  const artifact = {
    schemaVersion: 1,
    analysisId: "33333333-3333-4333-8333-333333333333",
    sourceId: ids.source,
    sourceHash: "a".repeat(64),
    engineVersion: "hve-active-speaker-eval-v1",
    generatedAt: "2026-08-03T00:00:00.000Z",
    durationUs: 4_000_000,
    faceAnalysisComplete: true,
    speakerTurns: [{ speakerId: "speaker-a", range: { startUs: 0, endUs: 2_000_000 }, confidence: 0.96 }],
    mouthActivity: [{ faceTrackId: "face-1", range: { startUs: 0, endUs: 2_000_000 }, activity: 0.88, faceConfidence: 0.95 }],
    activeSpeakerLinks: [{
      speakerId: "speaker-a",
      range: { startUs: 0, endUs: 2_000_000 },
      faceTrackId: "face-1",
      confidence: 0.9,
      reason: "audio_video_association" as const,
    }],
    provenance: {
      diarization: { engine: "sherpa-onnx-eval", modelVersion: "candidate-1", artifactSha256: "b".repeat(64) },
      mouthActivity: { engine: "mediapipe-eval", modelVersion: "candidate-1", artifactSha256: "c".repeat(64) },
    },
    warnings: [],
    artifactHash: "d".repeat(64),
  };
  assert.equal(hveActiveSpeakerArtifactSchema.safeParse(artifact).success, true);
  assert.equal(hveActiveSpeakerArtifactSchema.safeParse({
    ...artifact,
    activeSpeakerLinks: [{ ...artifact.activeSpeakerLinks[0], faceTrackId: null }],
  }).success, false);
  assert.equal(hveActiveSpeakerArtifactSchema.safeParse({
    ...artifact,
    activeSpeakerLinks: [{ ...artifact.activeSpeakerLinks[0], range: { startUs: 2_000_000, endUs: 4_000_000 } }],
  }).success, false);
});
