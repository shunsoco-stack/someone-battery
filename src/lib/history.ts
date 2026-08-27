import {
  HISTORY_LIMIT,
  isActivePost,
  parseStoredPost,
  type AppMode,
  type BatteryPost,
} from "./battery";

export function historyStorageKey(mode: "demo" | "live"): string {
  return `someone-battery:history:${mode}:v1`;
}

function persist(mode: "demo" | "live", posts: BatteryPost[]): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        historyStorageKey(mode),
        JSON.stringify(posts),
      );
    }
  } catch {
    // Private browsing/quota restrictions must not prevent viewing or posting.
  }
}

export function readHistory(mode: AppMode): BatteryPost[] {
  if (mode === "misconfigured" || typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(historyStorageKey(mode)) ?? "[]",
    );
    if (!Array.isArray(raw)) {
      persist(mode, []);
      return [];
    }
    const now = Date.now();
    const seen = new Set<string>();
    const history: BatteryPost[] = [];
    for (const entry of raw) {
      const post = parseStoredPost(entry, mode);
      if (!post || !isActivePost(post, now) || seen.has(post.id)) continue;
      seen.add(post.id);
      history.push(post);
      if (history.length === HISTORY_LIMIT) break;
    }
    // Purge expired/malformed records on read, including their unused extra fields.
    persist(mode, history);
    return history;
  } catch {
    persist(mode, []);
    return [];
  }
}

export function saveViewedPost(post: BatteryPost): BatteryPost[] {
  const validated = parseStoredPost(post, post.source);
  const history = readHistory(post.source);
  if (!validated || !isActivePost(validated)) return history;
  const next = [
    validated,
    ...history.filter((entry) => entry.id !== validated.id),
  ].slice(0, HISTORY_LIMIT);
  persist(post.source, next);
  return next;
}

export function clearHistory(mode: AppMode): void {
  if (mode === "misconfigured") return;
  try {
    if (typeof window !== "undefined")
      window.localStorage.removeItem(historyStorageKey(mode));
  } catch {
    // No remote record exists; the UI may still clear its in-memory history.
  }
}
