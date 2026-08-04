import {
  buildCaptionPlan,
  buildTimeMap,
  clipDocumentV2Schema,
  derivePauseRemovals,
  deriveTextCutRemovals,
  type CaptionPlan,
  type ClipDocumentV2,
  type TimeMapEntry,
  type TimelineRemoval,
  type TimingTranscriptWord,
} from "../../../../../packages/contracts/src/index.js";

export interface Hve2TimingPlan {
  timeMap: TimeMapEntry[];
  captions: CaptionPlan;
  audio: {
    timeMap: TimeMapEntry[];
    targetLufs: number;
    truePeakDb: number;
  };
}

/**
 * HVE-2's deterministic planner boundary. VAD supplies `derivedRemovals` as
 * source-time intervals; user/filler cuts are already in the document. It is
 * intentionally independent from the v1 renderer: enabling v2 rendering is
 * deferred until the compositor can execute the complete resolved plan.
 */
export function planHve2Timing(
  documentInput: ClipDocumentV2,
  transcriptWords: TimingTranscriptWord[],
  derivedRemovals: TimelineRemoval[] = [],
): Hve2TimingPlan {
  const document = clipDocumentV2Schema.parse(documentInput);
  const userRemovals: TimelineRemoval[] = document.audio.sourceCuts.map((cut) => ({
    sourceId: cut.sourceId,
    sourceRange: cut.sourceRange,
    reason: cut.reason,
  }));
  const automaticPauseRemovals = derivePauseRemovals(transcriptWords, document.audio.pauseRemoval);
  const textCutRemovals = deriveTextCutRemovals(transcriptWords, document.captions);
  const timeMap = buildTimeMap({
    narrative: document.narrative,
    removals: [...userRemovals, ...textCutRemovals, ...automaticPauseRemovals, ...derivedRemovals],
    crossfadeUs: document.audio.pauseRemoval.crossfadeUs,
  });
  const captions = buildCaptionPlan({
    timeMap,
    transcriptWords,
    track: document.captions,
  });
  return {
    timeMap,
    captions,
    audio: {
      timeMap,
      targetLufs: document.audio.loudness.targetLufs,
      truePeakDb: document.audio.loudness.truePeakDb,
    },
  };
}
