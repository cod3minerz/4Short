---
name: subtitle-styles
description: Reference for the subtitle preset catalogue used in the wizard, styles page and clip editor — the mismatch between UI presets and backend presets, and the rule that every preset must render a real visual sample. Use when touching subtitle style pickers or SubtitlePreviewOverlay. Keywords: subtitle preset, caption style, karaoke, active word, minimal box, speaker colors, SubtitlePreviewOverlay.
---

# Subtitle style catalogue

## The enum mismatch (real, not yet reconciled)

- UI (`app/dashboard/types.ts` `SubtitlePreset`): 7 values — `clean, bold, karaoke, active_word, word_pop, minimal_box, speaker_colors`.
- Contract (`packages/contracts/src/media.ts:30-53`): 6 values — `clean, bold, pulse, karaoke, minimal_box, speaker_colors`.
- `subtitleApiPreset()` in `clip-editor.tsx` maps both `active_word` and `word_pop` to the contract's `bold` — they are visually distinct in the UI preview but currently indistinguishable in what actually gets sent to render.
- The contract's `pulse` preset has no UI counterpart at all.

Don't design new UI around the 7-value UI enum as if it's authoritative — it isn't what the worker receives.

## Burn-in reality (Phase F1 — done, but only halfway to what the preview shows)

Subtitles now genuinely burn into rendered video (`services/control-api/src/services/subtitles.ts` `buildSubtitleCues`) — previously every render sent `subtitleCues: []` and the ASS pass never ran, so nothing a user configured ever showed up in the output. The burn-in path is still **segment-level only**: one cue per transcript segment (a full sentence/speaker turn), not per word. The OpenAI-compatible `verbose_json` parser now persists word timings into `transcript_segments.words`, while the default Yandex SpeechKit path still lacks a verified parser; neither path currently compiles those words into per-word ASS events. Therefore `active_word`/`karaoke`/`word_by_word` in `SubtitlePreviewOverlay` honestly demonstrate the STYLE but not the exact final timing. Don't remove the animated preview, but don't describe it as pixel-accurate until `buildSubtitleCues` emits per-word cues for a provider with verified timings.

## The one rule for any preset list

**Every preset must render a real, distinguishing visual sample — never a plain label.** This was the actual complaint that started the redesign: presets looked identical because only a tiny swatch changed, not the preview itself.

Use `SubtitlePreviewOverlay` (`app/dashboard/components/ui/SubtitlePreviewOverlay.tsx`) for any place that shows what a preset looks like — wizard step 3, the styles page, the editor's subtitle section. It already implements genuinely different CSS treatment per preset (karaoke underline, active-word scale, word-pop spring animation, minimal-box inverted plates, speaker-colors alternating tint) and respects `prefers-reduced-motion`. **Never build a fifth one-off caption preview** — that's exactly how the previous three drifted out of sync with each other.

For a scrollable style-sample list (per the mechanics doc's "СТИЛЬ СУБТИТРОВ (29)" pattern with grouped categories like GLOW/CLEAN), each row should render `SubtitlePreviewOverlay` (or a compact variant of it) with real sample text in that row's preset — not a static "Abc Xyz" label in a generic font.
