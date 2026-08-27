import { describe, expect, it, vi } from "vitest";
import {
  assertPercentage,
  EXPIRY_CLOCK_TOLERANCE_MS,
  generateAnonymousName,
  getBatteryMood,
  isActivePost,
  isAnonymousName,
  isValidPercentage,
  NAME_ANIMALS,
  NAME_PREFIXES,
  parseStoredPost,
  POST_LIFETIME_MS,
  relativeTime,
  type BatteryPost,
} from "../../src/lib/battery";

const now = Date.UTC(2026, 7, 27, 12);
const post: BatteryPost = {
  id: "test-post",
  percentage: 67,
  createdAt: now - 60_000,
  expiresAt: now - 60_000 + POST_LIFETIME_MS,
  anonymousName: "電池に強いカピバラ",
  source: "live",
};

describe("battery percentage validation", () => {
  it.each([0, 1, 20, 67, 99, 100])("accepts the integer %s", (value) => {
    expect(isValidPercentage(value)).toBe(true);
    expect(() => assertPercentage(value)).not.toThrow();
  });

  it.each([-1, 101, 10.5, NaN, Infinity, -Infinity, "67", "", null, undefined, {}, true])(
    "rejects invalid values (%s) without coercion",
    (value) => {
      expect(isValidPercentage(value)).toBe(false);
      expect(() => assertPercentage(value)).toThrow(RangeError);
    },
  );

  it.each([[0, "empty"], [1, "low"], [20, "low"], [21, "steady"], [99, "steady"], [100, "full"]] as const)(
    "maps %s to %s",
    (percentage, mood) => expect(getBatteryMood(percentage)).toBe(mood),
  );
});

describe("anonymous names", () => {
  it("only accepts complete combinations from the non-geographic vocabulary", () => {
    for (const prefix of NAME_PREFIXES) {
      for (const animal of NAME_ANIMALS) expect(isAnonymousName(prefix + animal)).toBe(true);
    }
    expect(isAnonymousName("北海道のたぶん眠い人")).toBe(false);
    expect(isAnonymousName("someone@example.com")).toBe(false);
    expect(isAnonymousName("充電を忘れたペンギン\n")).toBe(false);
    expect(isAnonymousName("<script>alert(1)</script>")).toBe(false);
  });

  it("generates an allowed name without user input", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0);
    expect(generateAnonymousName()).toBe("充電を忘れたペンギン");
    for (let index = 0; index < 100; index += 1) expect(isAnonymousName(generateAnonymousName())).toBe(true);
  });
});

describe("strict 24-hour visibility", () => {
  it("includes an active post and excludes the exact 24-hour boundary", () => {
    expect(isActivePost(post, now)).toBe(true);
    expect(isActivePost(post, post.createdAt + POST_LIFETIME_MS - 1)).toBe(true);
    expect(isActivePost(post, post.createdAt + POST_LIFETIME_MS)).toBe(false);
  });

  it("uses the earlier of explicit expiry and the server-created 24-hour lifetime", () => {
    const generousExpiry = { ...post, expiresAt: post.expiresAt + EXPIRY_CLOCK_TOLERANCE_MS };
    expect(isActivePost(generousExpiry, post.createdAt + POST_LIFETIME_MS)).toBe(false);
    expect(isActivePost({ ...post, expiresAt: now }, now)).toBe(false);
  });

  it("rejects future, non-finite, and expired timestamps", () => {
    expect(isActivePost({ ...post, createdAt: now + 1 }, now)).toBe(false);
    expect(isActivePost({ ...post, createdAt: NaN }, now)).toBe(false);
    expect(isActivePost({ ...post, expiresAt: Infinity }, now)).toBe(false);
    expect(isActivePost(post, NaN)).toBe(false);
  });
});

describe("untrusted stored data", () => {
  it("retains only the public post shape", () => {
    expect(parseStoredPost({ ...post, privateField: "discard me" }, "live")).toEqual(post);
  });

  it("rejects cross-mode, malformed, and arbitrary user-supplied data", () => {
    expect(parseStoredPost(post, "demo")).toBeNull();
    expect(parseStoredPost({ ...post, percentage: "67" }, "live")).toBeNull();
    expect(parseStoredPost({ ...post, anonymousName: "personal name" }, "live")).toBeNull();
    expect(parseStoredPost({ ...post, expiresAt: post.expiresAt + 6 * 60_000 }, "live")).toBeNull();
    expect(parseStoredPost({ ...post, expiresAt: post.createdAt }, "live")).toBeNull();
    expect(parseStoredPost({ ...post, id: "" }, "live")).toBeNull();
    expect(parseStoredPost(null, "live")).toBeNull();
  });
});

describe("relative Japanese time", () => {
  it.each([[0, "たった今"], [59_999, "たった今"], [60_000, "1分前"], [180_000, "3分前"], [3_600_000, "1時間前"], [POST_LIFETIME_MS, "1日前"]] as const)(
    "formats an age of %s milliseconds",
    (age, text) => expect(relativeTime(now - age, now)).toBe(text),
  );
  it("handles future/non-finite values safely", () => {
    expect(relativeTime(now + 1_000, now)).toBe("たった今");
    expect(relativeTime(NaN, now)).toBe("時刻不明");
  });
});
