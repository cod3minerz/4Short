import assert from "node:assert/strict";
import test from "node:test";
import { parseSttResponse } from "../../services/control-api/src/services/transcript.js";

test("parses the canonical Faster-Whisper response into ordered segments", () => {
  const segments = parseSttResponse({
    task: "transcribe",
    language: "russian",
    duration: 8,
    text: "Но ведь первая версия. Первый продукт не обязан быть идеальным.",
    segments: [
      { id: 0, start: 0, end: 3.5, text: " Но ведь первая версия." },
      { id: 1, start: 3.5, end: 8, text: " Первый продукт не обязан быть идеальным." },
    ],
  });

  assert.ok(segments);
  assert.equal(segments!.length, 2);
  assert.deepEqual(segments!.map((segment) => segment.ordinal), [0, 1]);
  assert.equal(segments![0].startMs, 0);
  assert.equal(segments![0].endMs, 3500);
  assert.equal(segments![0].originalText, "Но ведь первая версия.");
  assert.equal(segments![1].startMs, 3500);
  assert.equal(segments![1].endMs, 8000);
});

test("buckets top-level word timings into the segment whose range they fall in", () => {
  const segments = parseSttResponse({
    segments: [
      { start: 0, end: 2, text: "раз два" },
      { start: 2, end: 4, text: "три четыре" },
    ],
    words: [
      { word: "раз", start: 0.1, end: 0.4 },
      { word: "два", start: 1.0, end: 1.3 },
      { word: "три", start: 2.2, end: 2.5 },
      { word: "четыре", start: 3.0, end: 3.4 },
    ],
  });

  assert.ok(segments);
  assert.deepEqual(segments![0].words.map((word) => word.word), ["раз", "два"]);
  assert.deepEqual(segments![1].words.map((word) => word.word), ["три", "четыре"]);
});

test("returns null for an unrecognized shape rather than guessing at field names", () => {
  assert.equal(parseSttResponse({ operationId: "abc", response: { chunks: [] } }), null);
  assert.equal(parseSttResponse(null), null);
  assert.equal(parseSttResponse({}), null);
  assert.equal(parseSttResponse({ segments: [] }), null);
});

test("drops segments with an inverted or missing time range instead of writing garbage", () => {
  const segments = parseSttResponse({
    segments: [
      { start: 0, end: 2, text: "good" },
      { start: 5, end: 2, text: "inverted, dropped" },
      { start: 2, end: 2, text: "zero-length, dropped" },
      { text: "no timing at all, dropped" },
      { start: 2, end: 4, text: "" },
    ],
  });

  assert.ok(segments);
  assert.equal(segments!.length, 1);
  assert.equal(segments![0].originalText, "good");
});
