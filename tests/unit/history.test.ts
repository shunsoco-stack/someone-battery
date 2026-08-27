import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_LIMIT, POST_LIFETIME_MS, type BatteryPost } from "../../src/lib/battery";
import { clearHistory, historyStorageKey, readHistory, saveViewedPost } from "../../src/lib/history";

const now = Date.UTC(2026, 7, 27, 12);
const post = (id = "one", source: "demo" | "live" = "live"): BatteryPost => ({
  id,
  source,
  percentage: 67,
  createdAt: now - 60_000,
  expiresAt: now - 60_000 + POST_LIFETIME_MS,
  anonymousName: "電池に強いカピバラ",
});

let data: Map<string, string>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  data = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn((key: string) => data.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => data.set(key, value)),
      removeItem: vi.fn((key: string) => data.delete(key)),
    },
  });
});
afterEach(() => vi.useRealTimers());

describe("local-only viewing history", () => {
  it("moves a previously seen post to the front without duplicates", () => {
    saveViewedPost(post("one"));
    saveViewedPost(post("two"));
    saveViewedPost(post("one"));
    expect(readHistory("live").map((item) => item.id)).toEqual(["one", "two"]);
  });

  it("retains at most the latest 12 views, not all submissions", () => {
    for (let index = 0; index < 20; index += 1) saveViewedPost(post(String(index)));
    const history = readHistory("live");
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0].id).toBe("19");
    expect(history[11].id).toBe("8");
  });

  it("separates demo/live histories and removes only the requested one", () => {
    saveViewedPost(post("live", "live"));
    saveViewedPost(post("demo", "demo"));
    expect(readHistory("live").map((item) => item.id)).toEqual(["live"]);
    expect(readHistory("demo").map((item) => item.id)).toEqual(["demo"]);
    clearHistory("demo");
    expect(readHistory("demo")).toEqual([]);
    expect(readHistory("live")).toHaveLength(1);
  });

  it("physically prunes expired, duplicate, malformed, and wrong-mode records on read", () => {
    const expired = { ...post("expired"), createdAt: now - POST_LIFETIME_MS, expiresAt: now + 60_000 };
    data.set(historyStorageKey("live"), JSON.stringify([
      expired,
      post("valid"),
      post("valid"),
      post("demo", "demo"),
      { ...post("bad"), percentage: 101 },
    ]));
    expect(readHistory("live")).toEqual([post("valid")]);
    expect(JSON.parse(data.get(historyStorageKey("live"))!)).toEqual([post("valid")]);
  });

  it("does not add an expired post", () => {
    const expired = { ...post(), createdAt: now - POST_LIFETIME_MS, expiresAt: now };
    expect(saveViewedPost(expired)).toEqual([]);
  });

  it("strips unknown fields before persistence", () => {
    saveViewedPost({ ...post(), extra: "not stored" } as BatteryPost);
    expect(data.get(historyStorageKey("live"))).not.toContain("extra");
  });

  it("handles corrupt/non-array JSON", () => {
    data.set(historyStorageKey("live"), "{bad json");
    expect(readHistory("live")).toEqual([]);
    data.set(historyStorageKey("live"), JSON.stringify({ unexpected: true }));
    expect(readHistory("live")).toEqual([]);
  });

  it("degrades gracefully when browser storage is unavailable", () => {
    vi.stubGlobal("window", {
      get localStorage() { throw new DOMException("Storage blocked", "SecurityError"); },
    });
    expect(readHistory("live")).toEqual([]);
    expect(saveViewedPost(post())).toEqual([post()]);
    expect(() => clearHistory("live")).not.toThrow();
  });

  it("does not touch browser storage when unconfigured incorrectly or on the server", () => {
    expect(readHistory("misconfigured")).toEqual([]);
    clearHistory("misconfigured");
    expect(window.localStorage.getItem).not.toHaveBeenCalled();
    vi.stubGlobal("window", undefined);
    expect(readHistory("live")).toEqual([]);
    expect(() => clearHistory("live")).not.toThrow();
  });
});
