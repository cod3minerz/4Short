import assert from "node:assert/strict";
import test from "node:test";
import { clipDocumentV2Schema } from "../../packages/contracts/src/index.js";
import {
  assetIdsFromHveDocument,
  hveAssetResolverForPlan,
  hveDocumentRequiresPerception,
  renderAssetsForResolvedPlan,
} from "../../services/control-api/src/services/hve/render-input.js";
import { resolveHve3ExecutionPlan } from "../../services/control-api/src/services/hve/render-plan.js";

const ids = {
  clip: "10000000-0000-4000-8000-000000000031",
  source: "20000000-0000-4000-8000-000000000031",
  style: "30000000-0000-4000-8000-000000000031",
  analysis: "40000000-0000-4000-8000-000000000031",
  narrative: "50000000-0000-4000-8000-000000000031",
  layout: "60000000-0000-4000-8000-000000000031",
  logo: "70000000-0000-4000-8000-000000000031",
};

function documentFixture() {
  return clipDocumentV2Schema.parse({
    schemaVersion: 2,
    clipId: ids.clip,
    sourceRefs: [{ sourceId: ids.source, sourceHash: "a".repeat(64) }],
    timebase: { ticksPerSecond: 1_000_000, frameRate: { numerator: 30, denominator: 1 } },
    narrative: [{
      id: ids.narrative, sourceId: ids.source, sourceRange: { startUs: 0, endUs: 3_000_000 },
      enabled: true, order: 0, transcriptWordIds: [], transitionIn: "cut", transitionOut: "cut",
    }],
    layout: [{
      id: ids.layout,
      anchor: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
      template: "fill",
      slots: [{ slotId: "primary", regionRef: { analysisId: ids.analysis, trackId: "source", kind: "source" }, fit: "cover" }],
      provenance: { origin: "engine", reasonCode: "TEST" }, lockedByUser: false,
    }],
    captions: {
      enabled: true, language: "ru", words: [],
      style: {
        preset: "clean", fontFamily: "HVE Sans", fontSizePx: 56, fontWeight: 700,
        uppercase: false, maxWordsPerLine: 4, maxLines: 2, position: "bottom", safeMarginPx: 100,
        color: "#ffffff", activeColor: "#10b8f4", outlineColor: "#06131a", outlinePx: 3, background: false,
      },
    },
    layers: [{
      id: "80000000-0000-4000-8000-000000000031", type: "logo",
      anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
      followPolicy: "follow_narrative", zIndex: 1, anchor: "top_right",
      box: { x: 0.75, y: 0.05, width: 0.2, height: 0.1 }, opacity: 1, collisionPolicy: "warn", assetId: ids.logo,
    }],
    audio: {
      sourceCuts: [], pauseRemoval: { enabled: false, minimumUs: 0, beforePaddingUs: 0, afterPaddingUs: 0, crossfadeUs: 0 },
      loudness: { targetLufs: -16, truePeakDb: -1.5 },
    },
    export: { width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 5_000, audioBitrateKbps: 128, watermark: false },
    styleVersionId: ids.style, analysisId: ids.analysis, plannerVersion: "hve-test", rendererVersion: "hve-test",
  });
}

test("HVE render input resolves every referenced brand asset once", () => {
  const document = documentFixture();
  document.layers.push({ ...document.layers[0]!, id: "80000000-0000-4000-8000-000000000032", anchor: "bottom_right" });
  assert.deepEqual(assetIdsFromHveDocument(document), [ids.logo]);
});

test("HVE render job snapshot deduplicates a reused immutable asset", async () => {
  const document = documentFixture();
  document.layers.push({ ...document.layers[0]!, id: "80000000-0000-4000-8000-000000000032", anchor: "bottom_right" });
  const assets = new Map([[ids.logo, {
    assetId: ids.logo,
    bucket: "private",
    key: "brand/logo.png",
    sha256: "b".repeat(64),
    mimeType: "image/png" as const,
    byteSize: 400,
  }]]);
  const execution = await resolveHve3ExecutionPlan(document, [], hveAssetResolverForPlan(assets));
  const snapshot = renderAssetsForResolvedPlan(execution.resolvedPlan, assets);
  assert.deepEqual(snapshot, [assets.get(ids.logo)]);
  assert.doesNotMatch(JSON.stringify(execution.resolvedPlan), /"(?:bucket|key)"/);
});

test("HVE requests perception only for an explicit tracked crop, never for a static source layout", () => {
  const document = documentFixture();
  assert.equal(hveDocumentRequiresPerception(document), false);
  document.layout[0]!.slots[0]!.cropTrack = {
    analysisId: ids.analysis,
    trackId: "face-1",
  };
  assert.equal(hveDocumentRequiresPerception(document), true);
  document.layout[0]!.slots[0]!.manualCrop = { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };
  assert.equal(hveDocumentRequiresPerception(document), false);
});
