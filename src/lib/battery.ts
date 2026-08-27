/** Shared values are intentionally independent of browser and Firebase APIs. */
export const POST_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const EXPIRY_CLOCK_TOLERANCE_MS = 5 * 60 * 1_000;
export const HISTORY_LIMIT = 12;

export type AppMode = "demo" | "live" | "misconfigured";
export type BatteryMood = "empty" | "low" | "steady" | "full";

export interface BatteryPost {
  id: string;
  percentage: number;
  /** Epoch milliseconds in client-facing objects; Firestore stores Timestamp. */
  createdAt: number;
  expiresAt: number;
  anonymousName: string;
  /** Client-only provenance. Never written to a Firestore document. */
  source: "live" | "demo";
}

// Keep this vocabulary in sync with firestore.rules. No free text or locations.
export const NAME_PREFIXES = [
  "充電を忘れた",
  "電池に強い",
  "コンセントを探す",
  "うたた寝する",
  "のんびりしている",
  "夜ふかしの",
  "まだ元気な",
  "ひと休み中の",
] as const;

export const NAME_ANIMALS = [
  "ペンギン",
  "カピバラ",
  "ラッコ",
  "パンダ",
  "ハリネズミ",
  "ナマケモノ",
  "フクロウ",
  "コアラ",
] as const;

const allowedNames = new Set(
  NAME_PREFIXES.flatMap((prefix) =>
    NAME_ANIMALS.map((animal) => prefix + animal),
  ),
);

export function isValidPercentage(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

export function assertPercentage(value: unknown): asserts value is number {
  if (!isValidPercentage(value)) {
    throw new RangeError("充電残量は0〜100の整数で入力してください。");
  }
}

export function isAnonymousName(value: unknown): value is string {
  return typeof value === "string" && allowedNames.has(value);
}

export function generateAnonymousName(): string {
  const prefix =
    NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
  const animal = NAME_ANIMALS[Math.floor(Math.random() * NAME_ANIMALS.length)];
  return prefix + animal;
}

/** 0: empty; 1–20: low; 21–99: steady; 100: full. */
export function getBatteryMood(percentage: number): BatteryMood {
  assertPercentage(percentage);
  if (percentage === 0) return "empty";
  if (percentage <= 20) return "low";
  if (percentage === 100) return "full";
  return "steady";
}

/** Never extend display time by the expiry timestamp's five-minute write tolerance. */
export function isActivePost(post: BatteryPost, now = Date.now()): boolean {
  return (
    Number.isFinite(now) &&
    Number.isFinite(post.createdAt) &&
    Number.isFinite(post.expiresAt) &&
    post.createdAt <= now &&
    now < Math.min(post.createdAt + POST_LIFETIME_MS, post.expiresAt)
  );
}

/** Validate untrusted localStorage contents and strip any additional properties. */
export function parseStoredPost(
  value: unknown,
  source: "live" | "demo",
): BatteryPost | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.id !== "string" ||
    data.id.length === 0 ||
    data.id.length > 160 ||
    !isValidPercentage(data.percentage) ||
    !isAnonymousName(data.anonymousName) ||
    typeof data.createdAt !== "number" ||
    !Number.isSafeInteger(data.createdAt) ||
    data.createdAt <= 0 ||
    typeof data.expiresAt !== "number" ||
    !Number.isSafeInteger(data.expiresAt) ||
    data.expiresAt <= data.createdAt ||
    data.expiresAt >
      data.createdAt + POST_LIFETIME_MS + EXPIRY_CLOCK_TOLERANCE_MS ||
    data.source !== source
  ) {
    return null;
  }
  return {
    id: data.id,
    percentage: data.percentage,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt,
    anonymousName: data.anonymousName,
    source,
  };
}

export function relativeTime(createdAt: number, now = Date.now()): string {
  if (!Number.isFinite(createdAt) || !Number.isFinite(now)) return "時刻不明";
  const elapsed = Math.max(0, now - createdAt);
  if (elapsed < 60_000) return "たった今";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}分前`;
  if (elapsed < POST_LIFETIME_MS)
    return `${Math.floor(elapsed / (60 * 60_000))}時間前`;
  return `${Math.floor(elapsed / POST_LIFETIME_MS)}日前`;
}
