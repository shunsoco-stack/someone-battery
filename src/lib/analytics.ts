export const ANALYTICS_EVENTS = [
  "page_view",
  "battery_view",
  "battery_post",
  "battery_share",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
export const ANALYTICS_PREFERENCE_KEY = "someone-battery:analytics";

export function analyticsConfigured(): boolean {
  return process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true";
}

export function analyticsAllowed(): boolean {
  if (!analyticsConfigured()) return false;
  if (typeof window === "undefined") return false;
  if (
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true
  )
    return false;
  try {
    return localStorage.getItem(ANALYTICS_PREFERENCE_KEY) !== "off";
  } catch {
    return false;
  }
}

export function recordEvent(
  event: AnalyticsEvent,
  mode: "live" | "demo" | "misconfigured",
) {
  if (!analyticsAllowed() || mode === "misconfigured") return;
  // No vendor browser script, user agent, referrer, percentage, name, or ID.
  void fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, mode }),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    keepalive: true,
  }).catch(() => {
    /* Analytics must never interrupt an interaction. */
  });
}
