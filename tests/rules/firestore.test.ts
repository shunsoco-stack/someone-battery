import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { NAME_ANIMALS, NAME_PREFIXES, POST_LIFETIME_MS } from "../../src/lib/battery";

let environment: RulesTestEnvironment;
const projectId = "demo-someone-battery";
const collectionName = "batteryPosts";

function anonymousDb() {
  return environment.authenticatedContext("ephemeral-test-user", {
    firebase: { sign_in_provider: "anonymous", identities: {} },
  }).firestore();
}

function validData(overrides: Record<string, unknown> = {}) {
  return {
    percentage: 67,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + POST_LIFETIME_MS),
    anonymousName: "電池に強いカピバラ",
    ...overrides,
  };
}

async function seed(id = "existing", overrides: Record<string, unknown> = {}) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), collectionName, id), {
      ...validData(),
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
      ...overrides,
    });
  });
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Run npm run test:rules so these tests use the isolated Firestore emulator, never production.");
  }
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
  });
});
beforeEach(async () => { await environment.clearFirestore(); });
afterAll(async () => { await environment?.cleanup(); });

describe("anonymous battery post creation", () => {
  it.each([0, 1, 67, 99, 100])("allows valid integer %s with server-generated creation time", async (percentage) => {
    await assertSucceeds(setDoc(doc(anonymousDb(), collectionName, "valid"), validData({ percentage })));
  });

  it("allows every generated adjective/animal pair", async () => {
    const db = anonymousDb();
    await Promise.all(NAME_PREFIXES.flatMap((prefix, prefixIndex) => NAME_ANIMALS.map(async (animal, animalIndex) => {
      await assertSucceeds(setDoc(doc(db, collectionName, `name-${prefixIndex}-${animalIndex}`), validData({ anonymousName: prefix + animal })));
    })));
  });

  it.each([-1, 101, 50.5, "50", null, true, NaN, Infinity])("rejects invalid percentage %s", async (percentage) => {
    await assertFails(setDoc(doc(anonymousDb(), collectionName, "invalid"), validData({ percentage })));
  });

  it.each(["uid", "location", "device", "email", "source", "admin"])("rejects unnecessary field %s", async (field) => {
    await assertFails(setDoc(doc(anonymousDb(), collectionName, "extra"), validData({ [field]: "not allowed" })));
  });

  it.each(["percentage", "createdAt", "expiresAt", "anonymousName"])("requires field %s", async (field) => {
    const data: Record<string, unknown> = validData();
    delete data[field];
    await assertFails(setDoc(doc(anonymousDb(), collectionName, "missing"), data));
  });

  it.each(["北海道のたぶん眠い人", "someone@example.com", "", "充電を忘れたペンギン\n", "<script>alert(1)</script>"])(
    "rejects arbitrary personal/free-text name %s",
    async (anonymousName) => {
      await assertFails(setDoc(doc(anonymousDb(), collectionName, "name"), validData({ anonymousName })));
    },
  );

  it("rejects fabricated creation timestamps", async () => {
    await assertFails(setDoc(doc(anonymousDb(), collectionName, "fabricated"), validData({
      createdAt: Timestamp.fromMillis(Date.now() - 10_000),
    })));
  });

  it.each([-6, 6, 60 * 24])("rejects expiry skew of %s minutes beyond the 24-hour window", async (minutes) => {
    await assertFails(setDoc(doc(anonymousDb(), collectionName, "expiry"), validData({
      expiresAt: Timestamp.fromMillis(Date.now() + POST_LIFETIME_MS + minutes * 60_000),
    })));
  });

  it.each([-4, 4])("allows bounded client expiry skew of %s minutes", async (minutes) => {
    await assertSucceeds(setDoc(doc(anonymousDb(), collectionName, "skew"), validData({
      expiresAt: Timestamp.fromMillis(Date.now() + POST_LIFETIME_MS + minutes * 60_000),
    })));
  });

  it("rejects timestamp strings instead of native Firestore Timestamp values", async () => {
    await assertFails(setDoc(doc(anonymousDb(), collectionName, "string-time"), validData({
      expiresAt: new Date(Date.now() + POST_LIFETIME_MS).toISOString(),
    })));
  });
});

describe("authentication, reads, and immutable posts", () => {
  it("rejects unauthenticated reads and writes", async () => {
    await seed();
    const db = environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, collectionName, "existing")));
    await assertFails(getDocs(query(collection(db, collectionName), limit(200))));
    await assertFails(setDoc(doc(db, collectionName, "new"), validData()));
  });

  it("rejects non-anonymous authenticated providers", async () => {
    await seed();
    const db = environment.authenticatedContext("password-user", {
      firebase: { sign_in_provider: "password", identities: {} },
    }).firestore();
    await assertFails(getDoc(doc(db, collectionName, "existing")));
    await assertFails(setDoc(doc(db, collectionName, "new"), validData()));
  });

  it("allows anonymous direct read and the exact bounded production query", async () => {
    await seed();
    const db = anonymousDb();
    await assertSucceeds(getDoc(doc(db, collectionName, "existing")));
    await assertSucceeds(getDocs(query(
      collection(db, collectionName),
      where("createdAt", ">", Timestamp.fromMillis(Date.now() - POST_LIFETIME_MS)),
      where("createdAt", "<=", Timestamp.now()),
      orderBy("createdAt", "asc"),
      limit(200),
    )));
  });

  it("rejects unbounded/oversized list requests", async () => {
    const db = anonymousDb();
    await assertFails(getDocs(collection(db, collectionName)));
    await assertFails(getDocs(query(collection(db, collectionName), limit(201))));
  });

  it("rejects post update, overwrite, and delete even for the creating user", async () => {
    const reference = doc(anonymousDb(), collectionName, "immutable");
    await assertSucceeds(setDoc(reference, validData()));
    await assertFails(updateDoc(reference, { percentage: 100 }));
    await assertFails(setDoc(reference, validData({ percentage: 100 })));
    await assertFails(deleteDoc(reference));
  });

  it("rejects arbitrary collections and subcollections", async () => {
    const db = anonymousDb();
    await assertFails(setDoc(doc(db, "profiles", "user"), { email: "not stored" }));
    await assertFails(getDoc(doc(db, "profiles", "user")));
    await assertFails(setDoc(doc(db, collectionName, "parent", "private", "child"), validData()));
  });
});
