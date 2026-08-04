import { z } from "zod";
import { hveContentTypeSchema, hveSceneGraphSchema, type HveSceneGraph } from "./hve-perception.js";
import { timeRangeUsSchema } from "./hve-v2.js";
import { layoutTemplateIds, type LayoutTemplateId } from "./hve-layout.js";

/**
 * HVE-6 director output is a recommendation with an auditable trace, never a
 * hidden render instruction. The planner may use it only after the required
 * region artifacts and renderer capabilities have been verified.
 */
export const hveDirectorDecisionSchema = z.object({
  range: timeRangeUsSchema,
  template: z.enum(layoutTemplateIds),
  score: z.number().min(0).max(1),
  regionIds: z.array(z.string().min(1).max(160)).max(4),
  contentType: hveContentTypeSchema,
  trace: z.array(z.object({
    code: z.string().min(1).max(120),
    detail: z.string().min(1).max(500),
  }).strict()).min(1).max(50),
}).strict();

export const hveDirectorPlanSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: z.string().uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  decisions: z.array(hveDirectorDecisionSchema).min(1).max(20_000),
  warnings: z.array(z.object({
    code: z.string().min(1).max(120),
    userMessage: z.string().min(1).max(500),
  }).strict()).max(2_000),
}).strict();

export type HveDirectorDecision = z.infer<typeof hveDirectorDecisionSchema>;
export type HveDirectorPlan = z.infer<typeof hveDirectorPlanSchema>;

const roleForTemplate: Record<Exclude<LayoutTemplateId, "portrait_focus" | "blur_background">, readonly string[]> = {
  split_top_bottom: ["face", "face"],
  split_left_right: ["face", "face"],
  screen_speaker: ["screen", "face"],
  gameplay_facecam: ["gameplay", "facecam"],
  picture_in_picture: ["screen", "face"],
  grid_3: ["face", "face", "face"],
  grid_4: ["face", "face", "face", "face"],
};

function overlap(left: { startUs: number; endUs: number }, right: { startUs: number; endUs: number }) {
  return left.startUs < right.endUs && right.startUs < left.endUs;
}

function confidenceForRange(graph: HveSceneGraph, range: { startUs: number; endUs: number }) {
  const classifications = graph.classifications.filter((item) => overlap(item.range, range));
  const aggregate = new Map<string, number>();
  for (const classification of classifications) {
    for (const [kind, score] of Object.entries(classification.probabilities)) {
      aggregate.set(kind, Math.max(aggregate.get(kind) ?? 0, Number(score)));
    }
  }
  const [type, score] = [...aggregate.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["unknown", 1];
  return { type: hveContentTypeSchema.parse(type), score };
}

function regionsForRoles(graph: HveSceneGraph, range: { startUs: number; endUs: number }, roles: readonly string[], minimumConfidence: number) {
  const available = graph.regions.filter((region) => region.confidence >= minimumConfidence && overlap(region.range, range));
  const used = new Set<string>();
  const output: string[] = [];
  for (const role of roles) {
    const region = available.find((item) => item.kind === role && !used.has(item.id));
    if (!region) return null;
    used.add(region.id);
    output.push(region.id);
  }
  return output;
}

function requestedTemplate(
  graph: HveSceneGraph,
  type: string,
  range: { startUs: number; endUs: number },
  minimumRegionConfidence: number,
): LayoutTemplateId | null {
  if (type === "screen_speaker") return "screen_speaker";
  if (type === "gameplay_facecam") return "gameplay_facecam";
  if (type === "panel" || type === "remote_grid") {
    const faces = graph.regions.filter((region) => region.kind === "face"
      && region.confidence >= minimumRegionConfidence && overlap(region.range, range));
    if (faces.length >= 4) return "grid_4";
    if (faces.length >= 3) return "grid_3";
    return null;
  }
  if (type === "conversation") return "split_top_bottom";
  return null;
}

function requiresCompositeEvidence(type: string) {
  return type === "screen_speaker"
    || type === "gameplay_facecam"
    || type === "conversation"
    || type === "panel"
    || type === "remote_grid";
}

const MINIMUM_LAYOUT_HOLD_US = 1_200_000;
const MAXIMUM_LAYOUT_HOLD_US = 1_800_000;

function safeTemplateFor(contentType: string): LayoutTemplateId {
  return contentType === "vertical_source" ? "blur_background" : "portrait_focus";
}

function regionIdsCoverRange(
  graph: HveSceneGraph,
  regionIds: readonly string[],
  range: { startUs: number; endUs: number },
) {
  return regionIds.length > 0 && regionIds.every((regionId) => {
    const region = graph.regions.find((candidate) => candidate.id === regionId);
    return Boolean(
      region
      && region.range.startUs <= range.startUs
      && region.range.endUs >= range.endUs,
    );
  });
}

function sameLayout(left: HveDirectorDecision, right: HveDirectorDecision) {
  return left.template === right.template
    && left.regionIds.length === right.regionIds.length
    && left.regionIds.every((id, index) => id === right.regionIds[index]);
}

/**
 * Short classification fluctuations must not create a sequence of visibly
 * different layouts. Keep a prior verified composite only when its exact
 * region evidence still covers the whole short interval; otherwise choose the
 * conservative source layout. This is intentionally a director policy rather
 * than a render-time smoothing hack, so the preview and renderer consume the
 * same resolved segments.
 */
function applyLayoutHysteresis(
  graph: HveSceneGraph,
  decisions: HveDirectorDecision[],
  warnings: HveDirectorPlan["warnings"],
  minimumHoldUs: number,
) {
  const stabilized: HveDirectorDecision[] = [];
  for (const rawDecision of decisions) {
    const previous = stabilized.at(-1);
    const durationUs = rawDecision.range.endUs - rawDecision.range.startUs;
    let decision = rawDecision;
    if (durationUs < minimumHoldUs && (!previous || !sameLayout(previous, rawDecision))) {
      if (previous && regionIdsCoverRange(graph, previous.regionIds, rawDecision.range)) {
        decision = {
          ...rawDecision,
          template: previous.template,
          regionIds: [...previous.regionIds],
          trace: [
            ...rawDecision.trace,
            {
              code: "HVE_DIRECTOR_HYSTERESIS_HOLD",
              detail: `Held ${previous.template} for a ${durationUs}µs transient because its verified regions still cover the interval.`,
            },
          ],
        };
      } else {
        decision = {
          ...rawDecision,
          template: safeTemplateFor(rawDecision.contentType),
          regionIds: [],
          trace: [
            ...rawDecision.trace,
            {
              code: "HVE_DIRECTOR_HYSTERESIS_SAFE_FALLBACK",
              detail: `Refused a ${durationUs}µs layout transition because no prior verified composite can safely be held.`,
            },
          ],
        };
        warnings.push({
          code: "HVE_DIRECTOR_TRANSIENT_LAYOUT_SUPPRESSED",
          userMessage: "Короткое изменение сцены не изменило макет: сохранён безопасный кадр, чтобы ролик не дёргался.",
        });
      }
    }

    const prior = stabilized.at(-1);
    if (prior && sameLayout(prior, decision) && prior.range.endUs === decision.range.startUs) {
      prior.range = { startUs: prior.range.startUs, endUs: decision.range.endUs };
      prior.trace = [
        ...prior.trace,
        ...decision.trace,
        {
          code: "HVE_DIRECTOR_LAYOUT_SEGMENTS_COALESCED",
          detail: "Adjacent intervals use the same verified layout and were merged to avoid a meaningless layout boundary.",
        },
      ].slice(-50);
      continue;
    }
    stabilized.push(decision);
  }
  return stabilized;
}

/**
 * Pure director: it does not mutate a document or queue a render. This lets
 * the editor expose why a recommendation is unavailable instead of inventing
 * a tracking result to satisfy a requested layout.
 */
export function directLayouts(
  graphInput: HveSceneGraph,
  options: {
    minimumRegionConfidence?: number;
    sourceRange?: { startUs: number; endUs: number };
    /** Internal policy only. A caller cannot reduce the verified anti-flicker hold below 1.2s. */
    minimumLayoutHoldUs?: number;
  } = {},
): HveDirectorPlan {
  const graph = hveSceneGraphSchema.parse(graphInput);
  const minimumRegionConfidence = Math.min(1, Math.max(0, options.minimumRegionConfidence ?? 0.8));
  const minimumLayoutHoldUs = Math.min(
    MAXIMUM_LAYOUT_HOLD_US,
    Math.max(MINIMUM_LAYOUT_HOLD_US, options.minimumLayoutHoldUs ?? MINIMUM_LAYOUT_HOLD_US),
  );
  const requestedRange = options.sourceRange ?? { startUs: 0, endUs: graph.durationUs };
  if (!Number.isInteger(requestedRange.startUs) || !Number.isInteger(requestedRange.endUs)
    || requestedRange.startUs < 0 || requestedRange.endUs > graph.durationUs
    || requestedRange.endUs <= requestedRange.startUs) {
    throw new RangeError("HVE director source range is invalid for this scene graph");
  }
  const boundaries = new Set<number>([requestedRange.startUs, requestedRange.endUs]);
  for (const shot of graph.shots) {
    boundaries.add(shot.range.startUs);
    boundaries.add(shot.range.endUs);
  }
  // A director must never use a source-wide conversation label to compose a
  // split while one participant is absent. Partition at verified face-track
  // boundaries so role evidence is evaluated on the exact same interval.
  for (const region of graph.regions) {
    boundaries.add(region.range.startUs);
    boundaries.add(region.range.endUs);
  }
  for (const item of graph.classifications) {
    boundaries.add(item.range.startUs);
    boundaries.add(item.range.endUs);
  }
  const ordered = [...boundaries]
    .filter((item) => item >= requestedRange.startUs && item <= requestedRange.endUs)
    .sort((a, b) => a - b);
  const decisions: HveDirectorDecision[] = [];
  const warnings: HveDirectorPlan["warnings"] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const range = { startUs: ordered[index - 1]!, endUs: ordered[index]! };
    if (range.endUs <= range.startUs) continue;
    const content = confidenceForRange(graph, range);
    const candidate = requestedTemplate(graph, content.type, range, minimumRegionConfidence);
    if (candidate) {
      const roles = roleForTemplate[candidate as keyof typeof roleForTemplate];
      const regionIds = regionsForRoles(graph, range, roles, minimumRegionConfidence);
      if (regionIds) {
        decisions.push({
          range,
          template: candidate,
          score: Math.min(1, (content.score + regionIds.length / roles.length) / 2),
          regionIds,
          contentType: content.type,
          trace: [{ code: "HVE_DIRECTOR_VERIFIED_REGIONS", detail: `Selected ${candidate} from ${regionIds.length} verified region tracks.` }],
        });
        continue;
      }
      warnings.push({
        code: "HVE_DIRECTOR_REGION_EVIDENCE_MISSING",
        userMessage: `Макет ${candidate} не применён: для него недостаточно подтверждённых областей кадра.`,
      });
    }
    if (!candidate && requiresCompositeEvidence(content.type)) {
      warnings.push({
        code: "HVE_DIRECTOR_REGION_EVIDENCE_MISSING",
        userMessage: "Составной макет не применён: недостаточно подтверждённых областей кадра.",
      });
    }
    decisions.push({
      range,
      template: content.type === "vertical_source" ? "blur_background" : "portrait_focus",
      score: Math.max(0.25, Math.min(0.75, content.score)),
      regionIds: [],
      contentType: content.type,
      trace: [{
        code: candidate ? "HVE_DIRECTOR_SAFE_FALLBACK" : "HVE_DIRECTOR_SAFE_DEFAULT",
        detail: candidate
          ? "Required region artifacts are missing, so no composite layout is assumed."
          : "No layout-specific evidence is required for the safe default.",
      }],
    });
  }
  return hveDirectorPlanSchema.parse({
    schemaVersion: 1,
    sourceId: graph.sourceId,
    sourceHash: graph.sourceHash,
    decisions: applyLayoutHysteresis(graph, decisions, warnings, minimumLayoutHoldUs),
    warnings,
  });
}
