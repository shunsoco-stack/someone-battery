import { beforeEach, describe, expect, it, vi } from "vitest";

const envNames = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

const mocks = vi.hoisted(() => ({
  app: { name: "someone-battery" },
  auth: { currentUser: null as { isAnonymous: boolean } | null },
  db: {},
  initializeApp: vi.fn(),
  initializeAuth: vi.fn(),
  getApps: vi.fn(),
  getFirestore: vi.fn(),
  signInAnonymously: vi.fn(),
  setPersistence: vi.fn(),
  memory: { type: "NONE" },
}));

vi.mock("firebase/app", () => ({ getApps: mocks.getApps, initializeApp: mocks.initializeApp }));
vi.mock("firebase/auth", () => ({
  initializeAuth: mocks.initializeAuth,
  getAuth: () => mocks.auth,
  setPersistence: mocks.setPersistence,
  inMemoryPersistence: mocks.memory,
  signInAnonymously: mocks.signInAnonymously,
}));
vi.mock("firebase/firestore", () => ({ getFirestore: mocks.getFirestore }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const key of envNames) vi.stubEnv(key, "");
  mocks.auth.currentUser = null;
  mocks.getApps.mockReturnValue([]);
  mocks.initializeApp.mockReturnValue(mocks.app);
  mocks.initializeAuth.mockReturnValue(mocks.auth);
  mocks.getFirestore.mockReturnValue(mocks.db);
  mocks.signInAnonymously.mockImplementation(async () => {
    mocks.auth.currentUser = { isAnonymous: true };
    return { user: mocks.auth.currentUser };
  });
});

describe("Firebase configuration mode", () => {
  it("is demo only when all four public settings are absent", async () => {
    const { getAppMode } = await import("../../src/lib/firebase");
    expect(getAppMode()).toBe("demo");
    vi.stubEnv(envNames[0], "   ");
    expect(getAppMode()).toBe("demo");
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
  });

  it.each(envNames)("treats a partial %s setting as an error, not a demo", async (key) => {
    vi.stubEnv(key, "configured");
    const { getAppMode, getFirebaseServices } = await import("../../src/lib/firebase");
    expect(getAppMode()).toBe("misconfigured");
    await expect(getFirebaseServices()).rejects.toThrow("Firebaseの設定が完了していません");
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it("uses live mode when all four settings exist without eagerly initializing anything", async () => {
    for (const key of envNames) vi.stubEnv(key, "configured");
    const { getAppMode } = await import("../../src/lib/firebase");
    expect(getAppMode()).toBe("live");
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
  });
});

describe("lazy anonymous in-memory authentication", () => {
  beforeEach(() => {
    for (const key of envNames) vi.stubEnv(key, "configured");
  });

  it("creates one in-memory anonymous session for concurrent user actions", async () => {
    const { getFirebaseServices } = await import("../../src/lib/firebase");
    const [first, second] = await Promise.all([getFirebaseServices(), getFirebaseServices()]);
    expect(first).toBe(second);
    expect(mocks.initializeApp).toHaveBeenCalledOnce();
    expect(mocks.initializeAuth).toHaveBeenCalledWith(mocks.app, { persistence: mocks.memory });
    expect(mocks.signInAnonymously).toHaveBeenCalledOnce();
    await getFirebaseServices();
    expect(mocks.signInAnonymously).toHaveBeenCalledOnce();
  });

  it("does not silently switch to demo after an auth failure", async () => {
    mocks.signInAnonymously.mockRejectedValueOnce(new Error("auth/network-request-failed"));
    const { getAppMode, getFirebaseServices } = await import("../../src/lib/firebase");
    await expect(getFirebaseServices()).rejects.toThrow("auth/network-request-failed");
    expect(getAppMode()).toBe("live");
    await expect(getFirebaseServices()).resolves.toHaveProperty("db");
  });
});
