import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isActivePost } from "../../src/lib/battery";

const services = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../src/lib/firebase", () => ({
  getAppMode: () => "live",
  getFirebaseServices: services.get,
  FirebaseConfigurationError: class extends Error {},
}));

let environment: RulesTestEnvironment;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Use npm run test:rules; this test must never connect to production.");
  environment = await initializeTestEnvironment({
    projectId: "demo-someone-battery",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  vi.resetModules();
  services.get.mockResolvedValue({
    db: environment.authenticatedContext("confirmation-test-user", {
      firebase: { sign_in_provider: "anonymous", identities: {} },
    }).firestore(),
  });
});
afterAll(async () => { await environment?.cleanup(); });

describe("real SDK post confirmation against the emulator", () => {
  it("resolves actual server timestamps and creates one document for two concurrent calls", async () => {
    const { submitPost } = await import("../../src/lib/posts");
    const [first, second] = await Promise.all([submitPost(67), submitPost(67)]);
    expect(first).toEqual(second);
    expect(first.percentage).toBe(67);
    expect(Number.isSafeInteger(first.createdAt)).toBe(true);
    expect(isActivePost(first)).toBe(true);
    const { db } = await services.get();
    const documents = await getDocs(query(collection(db, "batteryPosts"), limit(200)));
    expect(documents.size).toBe(1);
    expect(Object.keys(documents.docs[0].data()).sort()).toEqual(["anonymousName", "createdAt", "expiresAt", "percentage"]);
  });
});
