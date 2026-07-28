import assert from "node:assert/strict";
import test from "node:test";
import { clipEdlSchema, createProjectSchema, youtubeUrlSchema } from "../../packages/contracts/src/index.js";
import { defaultStyleConfig } from "../../packages/product-config/src/index.js";

test("YouTube validation rejects arbitrary and deceptive hosts", () => {
  assert.equal(youtubeUrlSchema.safeParse("https://youtube.com/watch?v=abc").success, true);
  assert.equal(youtubeUrlSchema.safeParse("https://youtu.be/abc").success, true);
  assert.equal(youtubeUrlSchema.safeParse("https://youtube.com.evil.example/watch?v=abc").success, false);
  assert.equal(youtubeUrlSchema.safeParse("http://127.0.0.1/video").success, false);
});

test("custom moment search requires a prompt", () => {
  const result = createProjectSchema.safeParse({
    title: "Подкаст",
    source: { kind: "youtube", url: "https://youtube.com/watch?v=abc" },
    momentSettings: {
      mode: "custom",
      count: "recommended",
      durationMinSeconds: 30,
      durationMaxSeconds: 60,
      diversity: "high",
      excludedTopics: [],
    },
    styleVersionId: "663bb257-2fc8-4a25-aa2b-d31532daf365",
  });
  assert.equal(result.success, false);
});

test("EDL rejects an inverted range and accepts a canonical vertical export", () => {
  const base = {
    schemaVersion: 1,
    sourceId: "663bb257-2fc8-4a25-aa2b-d31532daf365",
    sourceHash: "a".repeat(64),
    range: { startMs: 1_000, endMs: 60_000 },
    cuts: [],
    layout: defaultStyleConfig.layout,
    subtitles: defaultStyleConfig.subtitles,
    silence: defaultStyleConfig.silence,
    export: defaultStyleConfig.export,
    styleVersionId: "763bb257-2fc8-4a25-aa2b-d31532daf365",
    rendererVersion: "0.1.0",
  };
  assert.equal(clipEdlSchema.safeParse(base).success, true);
  assert.equal(clipEdlSchema.safeParse({ ...base, range: { startMs: 5_000, endMs: 1_000 } }).success, false);
});
