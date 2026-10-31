import { getEnv } from "../../env.js";

/** Port of services/media-worker moments.py + the find_moments stage (cloud Python is untouched). */

export type TranscriptSegment = { startMs: number; endMs: number; text: string };

export type MomentSettings = {
  count?: number;
  durationMinSeconds: number;
  durationMaxSeconds: number;
  allowThoughtCompletion: boolean;
  prompt?: string;
};

export type MomentCandidate = {
  startMs: number;
  endMs: number;
  title: string;
  topic: string;
  explanation: string;
  score: number | null;
  warnings: string[];
};

export class MomentsError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 502) {
    super(message);
  }
}

const SYSTEM_PROMPT =
  "Ты редактор коротких видео. Верни только JSON с массивом candidates. "
  + "Каждый кандидат содержит startMs, endMs, title, topic, explanation, score от 0 до 100. "
  + "Используй только таймкоды из транскрипта. Фрагмент должен быть самостоятельным, "
  + "завершённым и не обещать просмотры.";

export function compactTranscript(segments: TranscriptSegment[]): TranscriptSegment[] {
  const result = segments
    .map((item) => ({ startMs: Math.round(item.startMs), endMs: Math.round(item.endMs), text: item.text.trim() }))
    .filter((item) => item.startMs >= 0 && item.endMs > item.startMs && item.text.length > 0);
  if (!result.length) throw new MomentsError("TRANSCRIPT_EMPTY", "Transcript contains no usable speech", 422);
  return result;
}

export function chunkTranscript(segments: TranscriptSegment[], maxCharacters = 32_000, overlapSegments = 4) {
  const chunks: TranscriptSegment[][] = [];
  let cursor = 0;
  while (cursor < segments.length) {
    const chunk: TranscriptSegment[] = [];
    let size = 0;
    let index = cursor;
    while (index < segments.length) {
      const lineSize = segments[index]!.text.length + 32;
      if (chunk.length && size + lineSize > maxCharacters) break;
      chunk.push(segments[index]!);
      size += lineSize;
      index += 1;
    }
    chunks.push(chunk);
    if (index >= segments.length) break;
    cursor = Math.max(cursor + 1, index - overlapSegments);
  }
  return chunks;
}

export const transcriptText = (segments: TranscriptSegment[]) =>
  segments.map((item) => `[${item.startMs}-${item.endMs}] ${item.text}`).join("\n");

export function normalizeCandidates(raw: unknown, segments: TranscriptSegment[], settings: MomentSettings): MomentCandidate[] {
  if (!Array.isArray(raw)) return [];
  const sourceStart = segments[0]!.startMs;
  const sourceEnd = segments[segments.length - 1]!.endMs;
  const minimum = settings.durationMinSeconds * 1000;
  const maximum = settings.durationMaxSeconds * 1000 + (settings.allowThoughtCompletion ? 15_000 : 0);
  const normalized: MomentCandidate[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const startRaw = Number(record.startMs);
    const endRaw = Number(record.endMs);
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) continue;
    const startMs = Math.max(sourceStart, Math.trunc(startRaw));
    const endMs = Math.min(sourceEnd, Math.trunc(endRaw));
    const duration = endMs - startMs;
    if (duration < minimum || duration > maximum) continue;
    if (normalized.some((other) => Math.min(endMs, other.endMs) - Math.max(startMs, other.startMs) > duration * 0.8)) continue;
    const scoreNumber = record.score === null || record.score === undefined ? null : Number(record.score);
    const warnings = Array.isArray(record.warnings) ? record.warnings.slice(0, 10).map((value) => String(value).slice(0, 120)) : [];
    normalized.push({
      startMs,
      endMs,
      title: String(record.title || "Найденный момент").slice(0, 180),
      topic: String(record.topic || "Момент").slice(0, 120),
      explanation: String(record.explanation || "Законченный фрагмент").slice(0, 1000),
      score: scoreNumber !== null && Number.isFinite(scoreNumber) ? Math.max(0, Math.min(100, scoreNumber)) : null,
      warnings,
    });
  }
  const limit = Number.isInteger(settings.count) ? settings.count! : 20;
  return normalized.slice(0, Math.max(1, Math.min(limit, 50)));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(cleaned) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new MomentsError("LLM_INVALID_JSON", "Model returned invalid JSON");
}

function assertModelAllowed(model: string) {
  const env = getEnv();
  const allowed = new Set(env.LLM_ALLOWED_MODELS.split(",").map((value) => value.trim()).filter(Boolean));
  const blocked = env.LLM_BLOCKED_MODEL_PREFIXES.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const lowered = model.toLowerCase();
  if (!allowed.has(model) || lowered === "openrouter/auto" || blocked.some((prefix) => lowered.startsWith(prefix))) {
    throw new MomentsError("LLM_MODEL_DENIED", `Model ${model} is not allowed`, 500);
  }
}

export type CompleteJson = (model: string, system: string, prompt: string) => Promise<Record<string, unknown>>;

export const openRouterComplete: CompleteJson = async (model, system, prompt) => {
  const env = getEnv();
  assertModelAllowed(model);
  if (!env.OPENROUTER_API_KEY) throw new MomentsError("LLM_NOT_CONFIGURED", "Moment search is not configured", 503);
  let response: Response;
  try {
    response = await fetch(`${env.OPENROUTER_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(180_000),
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": env.API_PUBLIC_URL,
        "x-title": "Narezai",
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        provider: { allow_fallbacks: true, require_parameters: true, data_collection: "deny", zdr: true, sort: "price" },
      }),
    });
  } catch {
    throw new MomentsError("LLM_PROVIDER_UNAVAILABLE", "Moment search is temporarily unavailable", 503);
  }
  if (response.status >= 500 || response.status === 429) throw new MomentsError("LLM_PROVIDER_UNAVAILABLE", "Moment search is temporarily unavailable", 503);
  if (!response.ok) throw new MomentsError("LLM_REQUEST_REJECTED", "Moment search request was rejected", 502);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parseJsonObject(payload.choices?.[0]?.message?.content ?? "");
};

function defaultModels() {
  const env = getEnv();
  return { candidate: env.LLM_CANDIDATE_MODEL, rerank: env.LLM_RERANK_MODEL };
}

export async function findMoments(
  rawSegments: TranscriptSegment[],
  settings: MomentSettings,
  complete: CompleteJson = openRouterComplete,
  models: { candidate: string; rerank: string } = defaultModels(),
) {
  const segments = compactTranscript(rawSegments);
  const settingsJson = JSON.stringify(settings);
  const candidates: unknown[] = [];
  for (const chunk of chunkTranscript(segments)) {
    const response = await complete(
      models.candidate,
      SYSTEM_PROMPT,
      `Настройки: ${settingsJson}\n\nТранскрипт с таймкодами в миллисекундах:\n${transcriptText(chunk)}`,
    );
    if (Array.isArray(response.candidates)) candidates.push(...response.candidates);
  }
  if (!candidates.length) throw new MomentsError("MOMENTS_NOT_FOUND", "The model returned no usable moment candidates");
  const ranked = await complete(
    models.rerank,
    SYSTEM_PROMPT,
    `Настройки: ${settingsJson}\nУдалите дубли, сохраните сильнейшие фрагменты и разнообразие тем. Кандидаты: ${JSON.stringify(candidates.slice(0, 200))}`,
  );
  const normalized = normalizeCandidates(ranked.candidates ?? candidates, segments, settings);
  const result = normalized.length ? normalized : normalizeCandidates(candidates, segments, settings);
  if (!result.length) throw new MomentsError("MOMENTS_INVALID", "The model returned invalid moment ranges");
  return { candidates: result, models };
}
