import { track } from "../../lib/analytics";
import type { AppAnalyticsEvent } from "../types";

export function trackApp(event: AppAnalyticsEvent, properties: Record<string, unknown> = {}) {
  track(event, properties);
}

