import assert from "node:assert/strict";
import test from "node:test";
import { toEditorWords } from "../../app/dashboard/lib/transcript.js";

type Segment = Parameters<typeof toEditorWords>[0][number];

function segment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-1",
    ordinal: 0,
    speakerId: "Марина",
    startMs: 60_000,
    endMs: 64_000,
    words: [],
    originalText: "",
    ...overrides,
  } as Segment;
}

test("word ids follow the (segmentId, wordIndex) addressing transcript revisions use", () => {
  const words = toEditorWords([segment({ originalText: "первая версия честная" })]);

  assert.deepEqual(words.map((word) => word.id), ["seg-1:0", "seg-1:1", "seg-1:2"]);
  assert.deepEqual(words.map((word) => word.wordIndex), [0, 1, 2]);
  // Revisions address words by this pair, so a mismatch here silently edits
  // the wrong word server-side.
  assert.ok(words.every((word) => word.segmentId === "seg-1"));
});

test("per-word timings are read under any of the key spellings the jsonb may use", () => {
  const [byMs, bySeconds, byAltName] = toEditorWords([
    segment({
      words: [
        { text: "раз", startMs: 61_000 },
        { word: "два", start: 62.5 },
        { value: "три", beginMs: 63_000 },
      ],
    }),
  ]);

  assert.equal(byMs.word, "раз");
  assert.equal(byMs.seconds, 61);
  assert.equal(bySeconds.word, "два");
  assert.equal(bySeconds.seconds, 62.5);
  assert.equal(byAltName.word, "три");
  assert.equal(byAltName.seconds, 63);
});

test("without per-word timing, words spread evenly inside their own segment", () => {
  const words = toEditorWords([segment({ originalText: "а б в г" })]);

  assert.deepEqual(words.map((word) => word.seconds), [60, 61, 62, 63]);
  // Never past the segment: the playhead must stay inside the right sentence.
  assert.ok(words.every((word) => word.seconds >= 60 && word.endSeconds <= 64));
});

test("a single word spans its whole segment rather than collapsing to zero length", () => {
  const [only] = toEditorWords([segment({ originalText: "да" })]);

  assert.equal(only.seconds, 60);
  assert.equal(only.endSeconds, 64);
});

test("ranges never invert even when a stored timing sits past the segment end", () => {
  const [word] = toEditorWords([segment({ words: [{ text: "поздно", startMs: 70_000 }] })]);

  assert.ok(word.endSeconds >= word.seconds);
});

test("segments carry a clock label and a speaker fallback", () => {
  const [labelled] = toEditorWords([segment({ originalText: "текст" })]);
  const [anonymous] = toEditorWords([segment({ speakerId: null, originalText: "текст" })]);

  assert.equal(labelled.time, "1:00");
  assert.equal(labelled.speaker, "Марина");
  assert.equal(anonymous.speaker, "Спикер");
});

test("empty segments contribute nothing instead of producing blank words", () => {
  assert.deepEqual(toEditorWords([segment({ originalText: "   " })]), []);
  assert.deepEqual(toEditorWords([]), []);
});
