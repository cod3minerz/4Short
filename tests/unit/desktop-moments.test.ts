import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkTranscript,
  compactTranscript,
  findMoments,
  MomentsError,
  normalizeCandidates,
  type CompleteJson,
  type MomentSettings,
} from "../../services/control-api/src/services/desktop/moments.js";

const settings: MomentSettings = { durationMinSeconds: 20, durationMaxSeconds: 60, allowThoughtCompletion: true };
const models = { candidate: "m-candidate", rerank: "m-rerank" };
const speech = Array.from({ length: 12 }, (_, index) => ({ startMs: index * 10_000, endMs: index * 10_000 + 9_500, text: `фраза ${index}` }));

test("compactTranscript drops empty and inverted segments and rejects an empty transcript", () => {
  const result = compactTranscript([
    { startMs: 0, endMs: 1000, text: "  привет " },
    { startMs: 1000, endMs: 1000, text: "нулевая длина" },
    { startMs: 2000, endMs: 3000, text: "   " },
  ]);
  assert.deepEqual(result, [{ startMs: 0, endMs: 1000, text: "привет" }]);
  assert.throws(() => compactTranscript([{ startMs: 5, endMs: 4, text: "x" }]), (error) => error instanceof MomentsError && error.code === "TRANSCRIPT_EMPTY");
});

test("chunkTranscript splits long transcripts with overlap and never loses a segment", () => {
  const long = Array.from({ length: 50 }, (_, index) => ({ startMs: index * 1000, endMs: index * 1000 + 900, text: "x".repeat(500) }));
  const chunks = chunkTranscript(long, 4_000, 2);
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0]![0]!.startMs, 0);
  assert.equal(chunks.at(-1)!.at(-1)!.endMs, long.at(-1)!.endMs);
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(chunks[index]![0]!.startMs <= chunks[index - 1]!.at(-1)!.startMs, "chunks overlap");
  }
});

test("normalizeCandidates clamps to the transcript, enforces duration and removes near-duplicates", () => {
  const segments = compactTranscript(speech);
  const out = normalizeCandidates([
    { startMs: -500, endMs: 30_000, title: "A", score: 150 },
    { startMs: 100, endMs: 29_000, title: "дубль" },
    { startMs: 40_000, endMs: 45_000, title: "слишком короткий" },
    { startMs: 50_000, endMs: 90_000, title: "B", score: "oops" },
    "мусор",
  ], segments, settings);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.startMs, 0);
  assert.equal(out[0]!.score, 100);
  assert.equal(out[1]!.title, "B");
  assert.equal(out[1]!.score, null);
});

test("findMoments chunks, reranks and returns validated candidates", async () => {
  const calls: string[] = [];
  const complete: CompleteJson = async (model) => {
    calls.push(model);
    return { candidates: [{ startMs: 0, endMs: 30_000, title: "Начало", topic: "Тема", explanation: "ок", score: 80 }] };
  };
  const result = await findMoments(speech, settings, complete, models);
  assert.deepEqual(calls, ["m-candidate", "m-rerank"]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.title, "Начало");
});

test("findMoments fails closed when the model returns nothing usable", async () => {
  await assert.rejects(findMoments(speech, settings, async () => ({ candidates: [] }), models), (error) => error instanceof MomentsError && error.code === "MOMENTS_NOT_FOUND");
  await assert.rejects(
    findMoments(speech, settings, async () => ({ candidates: [{ startMs: 0, endMs: 1_000, title: "коротко" }] }), models),
    (error) => error instanceof MomentsError && error.code === "MOMENTS_INVALID",
  );
});
