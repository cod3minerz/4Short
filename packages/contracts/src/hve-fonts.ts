import { z } from "zod";

/**
 * Renderer-owned font pack.
 *
 * A browser may preview a locally installed font, but final subtitles must
 * never depend on the host font database.  The first shipping pack contains
 * one open, bundled family.  More built-in or user-uploaded fonts need their
 * own immutable asset-and-license pipeline; accepting an arbitrary family
 * string would otherwise produce a silent libass fallback.
 */
export const HVE_DEFAULT_FONT_ID = "hve-sans-v1" as const;
export const HVE_DEFAULT_FONT_FAMILY = "HVE Sans" as const;
export const HVE_RENDER_FONT_FAMILY = "DejaVu Sans" as const;

export const hveFontPlanSchema = z.object({
  id: z.literal(HVE_DEFAULT_FONT_ID),
  /** User-facing family selected in the editor. */
  requestedFamily: z.literal(HVE_DEFAULT_FONT_FAMILY),
  /** Exact family installed in the worker image and passed to libass. */
  rendererFamily: z.literal(HVE_RENDER_FONT_FAMILY),
  /** Bump with every image/font-pack change; included in the render hash. */
  packVersion: z.literal("hve-font-pack-dejavu-2.37-1"),
}).strict();

export type HveFontPlan = z.infer<typeof hveFontPlanSchema>;

export class HveFontNotExecutableError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "HveFontNotExecutableError";
  }
}

/**
 * Resolve the only renderer-proven font pack. This is deliberately strict:
 * custom fontAssetId and arbitrary CSS family names cannot be represented as
 * a successful final render until font ingestion has been implemented.
 */
export function resolveHveFontPlan(style: { fontFamily: string; fontAssetId?: string }): HveFontPlan {
  if (style.fontAssetId) {
    throw new HveFontNotExecutableError(
      "HVE_CUSTOM_FONT_UNSUPPORTED",
      "Пользовательские шрифты ещё не готовы для безопасного финального рендера.",
    );
  }
  if (style.fontFamily !== HVE_DEFAULT_FONT_FAMILY) {
    throw new HveFontNotExecutableError(
      "HVE_FONT_NOT_INSTALLED",
      "Выбранный шрифт не входит в проверенный пакет рендера. Выберите HVE Sans.",
    );
  }
  return hveFontPlanSchema.parse({
    id: HVE_DEFAULT_FONT_ID,
    requestedFamily: HVE_DEFAULT_FONT_FAMILY,
    rendererFamily: HVE_RENDER_FONT_FAMILY,
    packVersion: "hve-font-pack-dejavu-2.37-1",
  });
}
