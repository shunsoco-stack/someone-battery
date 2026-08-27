import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST_LIFETIME_MS } from "../../src/lib/battery";

const mocks = vi.hoisted(() => ({
  mode: "demo" as "demo" | "live" | "misconfigured",
  services: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getCache: vi.fn(),
  doc: vi.fn(),
  startAfter: vi.fn(),
  serverTimestamp: { server: "timestamp-transform" },
}));
vi.mock("../../src/lib/firebase", () => ({
  getAppMode: () => mocks.mode,
  getFirebaseServices: mocks.services,
  FirebaseConfigurationError: class extends Error {
    constructor() { super("Firebaseの設定が完了していません"); }
  },
}));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  query: (collection: unknown, ...constraints: unknown[]) => ({ collection, constraints }),
  where: (field: string, operator: string, value: unknown) => ({ field, operator, value }),
  orderBy: (field: string, direction: string) => ({ field, direction }),
  limit: (count: number) => ({ limit: count }),
  startAfter: mocks.startAfter,
  getDocsFromServer: mocks.getDocs,
  doc: mocks.doc,
  setDoc: mocks.setDoc,
  getDocFromServer: mocks.getDoc,
  getDocFromCache: mocks.getCache,
  serverTimestamp: () => mocks.serverTimestamp,
  Timestamp: { fromMillis: (value: number) => ({ toMillis: () => value }) },
}));

const now = Date.UTC(2026, 7, 27, 12);
const timestamp = (value: number) => ({ toMillis: () => value });
const liveData = (overrides: Record<string, unknown> = {}) => ({
  percentage: 67,
  createdAt: timestamp(now - 60_000),
  expiresAt: timestamp(now - 60_000 + POST_LIFETIME_MS),
  anonymousName: "電池に強いカピバラ",
  ...overrides,
});
const snapshot = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  data: () => liveData(overrides),
  exists: () => true,
  metadata: { hasPendingWrites: false, fromCache: false },
});
const page = (docs: ReturnType<typeof snapshot>[]) => ({ docs, size: docs.length });
let storage: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.mode = "demo";
  mocks.services.mockResolvedValue({ db: {} });
  mocks.setDoc.mockResolvedValue(undefined);
  mocks.getDocs.mockResolvedValue(page([]));
  mocks.getDoc.mockResolvedValue(snapshot("server-id"));
  mocks.getCache.mockResolvedValue(snapshot("server-id"));
  mocks.doc.mockReturnValue({ id: "server-id" });
  mocks.startAfter.mockImplementation((last: unknown) => ({ after: last }));
  storage = new Map();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
});
afterEach(() => vi.useRealTimers());

describe("explicit demo data", () => {
  it("labels every fixture and never requests anonymous authentication", async () => {
    const { getRandomPost, getDemoPost } = await import("../../src/lib/posts");
    expect((await getRandomPost())?.source).toBe("demo");
    expect(getDemoPost(8)).toMatchObject({ percentage: 8, source: "demo" });
    expect(getDemoPost(100)).toMatchObject({ percentage: 100, source: "demo" });
    expect(mocks.services).not.toHaveBeenCalled();
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it("does not show the same demo twice when alternatives exist", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { getRandomPost } = await import("../../src/lib/posts");
    const first = await getRandomPost();
    const next = await getRandomPost(first!.id);
    expect(next?.id).not.toBe(first?.id);
  });

  it("stores self-reported demo posts separately without a Firestore write", async () => {
    const { submitPost, DEMO_POSTS_STORAGE_KEY } = await import("../../src/lib/posts");
    const post = await submitPost(0);
    expect(post).toMatchObject({ percentage: 0, source: "demo", createdAt: now });
    expect(JSON.parse(storage.get(DEMO_POSTS_STORAGE_KEY)!)).toEqual([post]);
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(mocks.services).not.toHaveBeenCalled();
  });

  it("keeps a submitted demo usable even if storage is blocked", async () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("blocked"); } });
    const { submitPost } = await import("../../src/lib/posts");
    await expect(submitPost(42)).resolves.toMatchObject({ source: "demo", percentage: 42 });
  });

  it.each(["live", "misconfigured"] as const)("forbids demo fixtures in %s mode", async (mode) => {
    mocks.mode = mode;
    const { getDemoPost } = await import("../../src/lib/posts");
    expect(() => getDemoPost(8)).toThrow("Firebaseの設定");
  });
});

describe("real random read", () => {
  beforeEach(() => { mocks.mode = "live"; });

  it("returns null for a genuinely empty live collection without demo fallback", async () => {
    const { getRandomPost } = await import("../../src/lib/posts");
    expect(await getRandomPost()).toBeNull();
    expect(mocks.services).toHaveBeenCalledOnce();
  });

  it("filters expired, future, invalid, and over-specified documents", async () => {
    mocks.getDocs.mockResolvedValue(page([
      snapshot("expired", { createdAt: timestamp(now - POST_LIFETIME_MS), expiresAt: timestamp(now + 60_000) }),
      snapshot("future", { createdAt: timestamp(now + 1_000) }),
      snapshot("bad-percentage", { percentage: 101 }),
      snapshot("extra-field", { location: "must not be saved" }),
      snapshot("bad-name", { anonymousName: "someone@example.com" }),
      snapshot("valid"),
    ]));
    const { getRandomPost } = await import("../../src/lib/posts");
    expect(await getRandomPost()).toMatchObject({ id: "valid", source: "live", percentage: 67 });
  });

  it("normalizes server timestamps with fractional milliseconds", async () => {
    mocks.getDocs.mockResolvedValue(page([
      snapshot("microseconds", { createdAt: timestamp(now - 1_000 + 0.123), expiresAt: timestamp(now + POST_LIFETIME_MS - 1_000 + 0.456) }),
    ]));
    const { getRandomPost } = await import("../../src/lib/posts");
    expect(await getRandomPost()).toMatchObject({ id: "microseconds", createdAt: now - 1_000 });
  });

  it("paginates beyond 200 records instead of biasing towards a limited newest subset", async () => {
    const first = Array.from({ length: 200 }, (_, index) => snapshot(`page-1-${index}`));
    mocks.getDocs.mockResolvedValueOnce(page(first)).mockResolvedValueOnce(page([snapshot("page-2")]));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { getRandomPost } = await import("../../src/lib/posts");
    expect(await getRandomPost()).toMatchObject({ id: "page-2" });
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(mocks.startAfter).toHaveBeenCalledWith(first[199]);
  });

  it("avoids the previously viewed post unless it is the only active one", async () => {
    const { getRandomPost } = await import("../../src/lib/posts");
    mocks.getDocs.mockResolvedValueOnce(page([snapshot("previous"), snapshot("other")]));
    expect(await getRandomPost("previous")).toMatchObject({ id: "other" });
    mocks.getDocs.mockResolvedValueOnce(page([snapshot("previous")]));
    expect(await getRandomPost("previous")).toMatchObject({ id: "previous" });
  });

  it("reports unavailable data as an error, never as an empty collection or demo", async () => {
    mocks.getDocs.mockRejectedValueOnce(new Error("permission-denied"));
    const { getRandomPost } = await import("../../src/lib/posts");
    await expect(getRandomPost()).rejects.toThrow("読み込めませんでした");
  });
});

describe("real submission", () => {
  beforeEach(() => {
    mocks.mode = "live";
    // Fixed allowed name so both payload and confirmed snapshots can be compared.
    vi.spyOn(Math, "random").mockReturnValue(0.13);
  });

  it.each([-1, 101, 0.5, NaN, Infinity, "25", null])("rejects invalid input %s before authentication", async (value) => {
    const { submitPost } = await import("../../src/lib/posts");
    await expect(submitPost(value as number)).rejects.toThrow("0〜100の整数");
    expect(mocks.services).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it("writes exactly four fields and confirms the acknowledged write from memory without another network read", async () => {
    const { submitPost } = await import("../../src/lib/posts");
    const result = await submitPost(67);
    expect(result).toMatchObject({ id: "server-id", source: "live", percentage: 67 });
    const payload = mocks.setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["anonymousName", "createdAt", "expiresAt", "percentage"]);
    expect(payload.createdAt).toBe(mocks.serverTimestamp);
    expect((payload.expiresAt as { toMillis(): number }).toMillis()).toBe(now + POST_LIFETIME_MS);
    expect(mocks.getCache).toHaveBeenCalledOnce();
    expect(mocks.getDoc).not.toHaveBeenCalled();
  });

  it("does not fabricate success after a rejected write", async () => {
    mocks.setDoc.mockRejectedValueOnce(new Error("permission-denied"));
    const { submitPost } = await import("../../src/lib/posts");
    await expect(submitPost(67)).rejects.toThrow("投稿を確認できませんでした");
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.getCache).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it("waits for the server acknowledgement before considering cached data", async () => {
    let acknowledge!: () => void;
    mocks.setDoc.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    const { submitPost } = await import("../../src/lib/posts");
    const submission = submitPost(67);
    await vi.waitFor(() => expect(mocks.setDoc).toHaveBeenCalledOnce());
    expect(mocks.getCache).not.toHaveBeenCalled();
    acknowledge();
    await expect(submission).resolves.toMatchObject({ id: "server-id", percentage: 67 });
  });

  it("joins concurrent calls for the same attempt instead of creating a second document", async () => {
    let acknowledge!: () => void;
    mocks.setDoc.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    const { submitPost } = await import("../../src/lib/posts");
    const first = submitPost(67);
    const second = submitPost(67);
    await vi.waitFor(() => expect(mocks.setDoc).toHaveBeenCalledOnce());
    await expect(submitPost(42)).rejects.toThrow("先ほどの67%");
    acknowledge();
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(mocks.doc).toHaveBeenCalledOnce();
    expect(mocks.setDoc).toHaveBeenCalledOnce();
    expect(mocks.getCache).toHaveBeenCalledOnce();
  });

  it("uses a server read of the same reference if eager memory GC removed the cache entry", async () => {
    mocks.getCache.mockRejectedValueOnce(new Error("unavailable: cache miss"));
    const { submitPost } = await import("../../src/lib/posts");
    await expect(submitPost(67)).resolves.toMatchObject({ id: "server-id" });
    expect(mocks.getDoc).toHaveBeenCalledWith(mocks.doc.mock.results[0].value);
    expect(mocks.setDoc).toHaveBeenCalledOnce();
  });

  it("retries confirmation only after an acknowledged write, even when both first reads fail", async () => {
    mocks.getCache.mockRejectedValueOnce(new Error("cache miss"));
    mocks.getDoc.mockRejectedValueOnce(new Error("network unavailable"));
    const { submitPost } = await import("../../src/lib/posts");
    await expect(submitPost(67)).rejects.toThrow("投稿は保存されています");
    await expect(submitPost(42)).rejects.toThrow("先ほどの67%");
    await expect(submitPost(67)).resolves.toMatchObject({ id: "server-id", percentage: 67 });
    expect(mocks.doc).toHaveBeenCalledOnce();
    expect(mocks.setDoc).toHaveBeenCalledOnce();
    expect(mocks.services).toHaveBeenCalledOnce();
    expect(mocks.getCache).toHaveBeenCalledTimes(2);
    expect(storage.size).toBe(0);
  });

  it("never treats pending local mutations as confirmed success", async () => {
    const pending = { ...snapshot("server-id"), metadata: { hasPendingWrites: true, fromCache: true } };
    mocks.getCache.mockResolvedValueOnce(pending);
    mocks.getDoc.mockResolvedValueOnce(pending);
    const { submitPost } = await import("../../src/lib/posts");
    await expect(submitPost(67)).rejects.toThrow("投稿は保存されています");
    await expect(submitPost(67)).resolves.toMatchObject({ id: "server-id" });
    expect(mocks.setDoc).toHaveBeenCalledOnce();
  });

  it("rejects mismatched confirmed contents rather than returning another percentage", async () => {
    mocks.getCache.mockResolvedValueOnce(snapshot("server-id", { percentage: 42 }));
    mocks.getDoc.mockResolvedValueOnce(snapshot("server-id", { percentage: 42 }));
    const { submitPost } = await import("../../src/lib/posts");
    await expect(submitPost(67)).rejects.toThrow("投稿は保存されています");
    await expect(submitPost(67)).resolves.toMatchObject({ percentage: 67 });
    expect(mocks.setDoc).toHaveBeenCalledOnce();
  });

  it("permits a new attempt after a definite rejected write", async () => {
    mocks.setDoc.mockRejectedValueOnce(new Error("permission-denied"));
    const { submitPost } = await import("../../src/lib/posts");
    await expect(submitPost(67)).rejects.toThrow("投稿を確認できませんでした");
    mocks.getCache.mockResolvedValueOnce(snapshot("server-id", { percentage: 42 }));
    await expect(submitPost(42)).resolves.toMatchObject({ percentage: 42 });
    expect(mocks.setDoc).toHaveBeenCalledTimes(2);
  });

  it("does not substitute demo data for partial configuration", async () => {
    mocks.mode = "misconfigured";
    const { submitPost, getRandomPost } = await import("../../src/lib/posts");
    await expect(submitPost(67)).rejects.toThrow("Firebaseの設定");
    await expect(getRandomPost()).rejects.toThrow("Firebaseの設定");
    expect(mocks.services).not.toHaveBeenCalled();
  });
});
