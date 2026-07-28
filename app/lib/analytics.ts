export type AnalyticsEvent =
  | "hero_url_focus" | "hero_url_submit" | "hero_upload_click"
  | "signup_start" | "signup_complete" | "video_upload_start"
  | "video_upload_complete" | "generation_start" | "generation_complete"
  | "pricing_view" | "plan_select" | "billing_period_change"
  | "minutes_package_select" | "minutes_purchase_start"
  | "minutes_purchase_complete" | "faq_open" | "final_cta_submit"
  | "blog_view" | "blog_search" | "blog_filter" | "blog_article_click"
  | "article_view" | "article_scroll_55" | "article_toc_click"
  | "article_cta_view" | "article_cta_submit" | "article_modal_open"
  | "article_modal_close" | "article_related_click";

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    ym?: (id: number, action: string, event: string, options?: Record<string, unknown>) => void;
    posthog?: { capture: (event: string, properties?: Record<string, unknown>) => void };
  }
}

export function track(event: AnalyticsEvent, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.dataLayer?.push({ event, ...properties });
  window.posthog?.capture(event, properties);
  const metrikaId = Number(process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID);
  if (metrikaId && window.ym) window.ym(metrikaId, "reachGoal", event, properties);
  if (process.env.NODE_ENV === "development") console.info("[4Short analytics]", event, properties);
}
