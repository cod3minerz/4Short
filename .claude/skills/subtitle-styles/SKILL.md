---
name: subtitle-styles
description: Reference for the subtitle preset catalogue used in the wizard, styles page and clip editor — the mismatch between UI presets and backend presets, and the rule that every preset must render a real visual sample. Use when touching subtitle style pickers or SubtitlePreviewOverlay. Keywords: subtitle preset, caption style, karaoke, active word, minimal box, speaker colors, SubtitlePreviewOverlay.
---

# Subtitle style catalogue

## Persisted preset contract

- UI (`app/dashboard/types.ts` `SubtitlePreset`): 7 values — `clean, bold, karaoke, active_word, word_pop, minimal_box, speaker_colors`.
- Contract (`packages/contracts/src/media.ts`): retains those seven values and additionally keeps `pulse` readable for older saved presets.
- `subtitleApiPreset()` serialises every selected preset directly. The mode controls active-word/word-pop/karaoke timing; the preset preserves visual identity for deterministic re-editing.
- `pulse` remains backwards-compatible and has no first-picker UI counterpart.

Do not add a preset unless its contract, preview and final renderer behaviour are all defined.

## Burn-in reality (Phase F1 — done, but only halfway to what the preview shows)

Subtitles now genuinely burn into rendered video. Local Faster-Whisper Large V3 Turbo persists word timings in `transcript_segments.words` and the HVE V2 planner maps those canonical words onto the same output clock as the video/audio cuts. The legacy renderer still emits segment-level cues, so its animated UI preview is not a pixel-parity claim. `active_word`/`karaoke`/`word_pop` must only be advertised as final-output-equivalent on the HVE V2 route after its visual corpus gate passes; there is no Yandex/SpeechKit STT path in this repository.

## The one rule for any preset list

**Every preset must render a real, distinguishing visual sample — never a plain label.** This was the actual complaint that started the redesign: presets looked identical because only a tiny swatch changed, not the preview itself.

Use `SubtitlePreviewOverlay` (`app/dashboard/components/ui/SubtitlePreviewOverlay.tsx`) for any place that shows what a preset looks like — wizard step 3, the styles page, the editor's subtitle section. It already implements genuinely different CSS treatment per preset (karaoke underline, active-word scale, word-pop spring animation, minimal-box inverted plates, speaker-colors alternating tint) and respects `prefers-reduced-motion`. **Never build a fifth one-off caption preview** — that's exactly how the previous three drifted out of sync with each other.

For a scrollable style-sample list (per the mechanics doc's "СТИЛЬ СУБТИТРОВ (29)" pattern with grouped categories like GLOW/CLEAN), each row should render `SubtitlePreviewOverlay` (or a compact variant of it) with real sample text in that row's preset — not a static "Abc Xyz" label in a generic font.
