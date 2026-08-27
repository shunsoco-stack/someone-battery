import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import {
  assertPercentage,
  generateAnonymousName,
  isActivePost,
  isAnonymousName,
  isValidPercentage,
  parseStoredPost,
  POST_LIFETIME_MS,
  type BatteryPost,
} from "./battery";
import {
  FirebaseConfigurationError,
  getAppMode,
  getFirebaseServices,
} from "./firebase";

export const POSTS_COLLECTION = "batteryPosts";
export const POSTS_PAGE_SIZE = 200;
export const DEMO_POSTS_STORAGE_KEY = "someone-battery:demo-posts:v1";
const DEMO_POSTS_LIMIT = 50;
let demoFixtures: BatteryPost[] | undefined;
let inMemoryDemoPosts: BatteryPost[] = [];

type FirestoreSdk = typeof import("firebase/firestore");
interface LiveSubmissionAttempt {
  percentage: number;
  anonymousName: string;
  acknowledged: boolean;
  reference?: DocumentReference<DocumentData>;
  sdk?: FirestoreSdk;
  inFlight?: Promise<BatteryPost>;
}

// Session-memory only, never localStorage. A confirmation failure must not turn a
// retry of one acknowledged write into a second document with a new random ID.
let liveSubmissionAttempt: LiveSubmissionAttempt | undefined;

function requireDemo(): void {
  if (getAppMode() !== "demo") throw new FirebaseConfigurationError();
}

/** Explicit, labeled UI examples; never accessible from a live/misconfigured build. */
export function getDemoPost(percentage: number): BatteryPost {
  requireDemo();
  assertPercentage(percentage);
  const createdAt = Date.now() - 3 * 60_000;
  return {
    id: `demo-example-${percentage}`,
    percentage,
    createdAt,
    expiresAt: createdAt + POST_LIFETIME_MS,
    anonymousName:
      percentage <= 20 ? "充電を忘れたペンギン" : "電池に強いカピバラ",
    source: "demo",
  };
}

function getDemoFixtures(): BatteryPost[] {
  if (!demoFixtures) {
    demoFixtures = [67, 8, 100, 42, 19, 83].map((percentage, index) => {
      const example = getDemoPost(percentage);
      const createdAt = example.createdAt - index * 4 * 60_000;
      return {
        ...example,
        id: `demo-fixture-${percentage}`,
        createdAt,
        expiresAt: createdAt + POST_LIFETIME_MS,
      };
    });
  }
  return demoFixtures;
}

function readDemoPosts(): BatteryPost[] {
  try {
    if (typeof window !== "undefined") {
      const raw: unknown = JSON.parse(
        window.localStorage.getItem(DEMO_POSTS_STORAGE_KEY) ?? "[]",
      );
      if (Array.isArray(raw)) {
        const fromStorage = raw.flatMap((entry) => {
          const post = parseStoredPost(entry, "demo");
          return post && isActivePost(post) ? [post] : [];
        });
        const unique = new Map(
          [...inMemoryDemoPosts, ...fromStorage].map((post) => [post.id, post]),
        );
        inMemoryDemoPosts = [...unique.values()]
          .filter((post) => isActivePost(post))
          .slice(-DEMO_POSTS_LIMIT);
      }
    }
  } catch {
    // Demo mode remains usable if browser storage is disabled.
  }
  inMemoryDemoPosts = inMemoryDemoPosts.filter((post) => isActivePost(post));
  return inMemoryDemoPosts;
}

function saveDemoPost(post: BatteryPost): void {
  inMemoryDemoPosts = [...readDemoPosts(), post].slice(-DEMO_POSTS_LIMIT);
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        DEMO_POSTS_STORAGE_KEY,
        JSON.stringify(inMemoryDemoPosts),
      );
    }
  } catch {
    // The submitted demo remains available in memory for this visit.
  }
}

function choosePost(
  posts: BatteryPost[],
  excludeId?: string,
): BatteryPost | null {
  const eligible = posts.filter((post) => isActivePost(post));
  const alternatives = eligible.filter((post) => post.id !== excludeId);
  const pool = alternatives.length ? alternatives : eligible;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/** Accept only the server schema; unexpected fields never reach the UI/history. */
function parseLivePost(id: string, data: DocumentData): BatteryPost | null {
  const required = ["percentage", "createdAt", "expiresAt", "anonymousName"];
  if (
    Object.keys(data).length !== required.length ||
    !required.every((field) => field in data)
  )
    return null;
  if (
    !isValidPercentage(data.percentage) ||
    !isAnonymousName(data.anonymousName)
  )
    return null;
  if (
    typeof data.createdAt?.toMillis !== "function" ||
    typeof data.expiresAt?.toMillis !== "function"
  )
    return null;
  return parseStoredPost(
    {
      id,
      percentage: data.percentage,
      // Firestore's microsecond timestamps can return fractional milliseconds.
      createdAt: Math.floor(data.createdAt.toMillis()),
      expiresAt: Math.floor(data.expiresAt.toMillis()),
      anonymousName: data.anonymousName,
      source: "live",
    },
    "live",
  );
}

export async function getRandomPost(
  excludeId?: string,
): Promise<BatteryPost | null> {
  const mode = getAppMode();
  if (mode === "misconfigured") throw new FirebaseConfigurationError();
  if (mode === "demo")
    return choosePost([...getDemoFixtures(), ...readDemoPosts()], excludeId);

  try {
    const [{ db }, sdk] = await Promise.all([
      getFirebaseServices(),
      import("firebase/firestore"),
    ]);
    const scanStartedAt = Date.now();
    const posts = sdk.collection(db, POSTS_COLLECTION);
    // Freeze both time bounds across pages; do not silently sample only the newest N.
    const baseConstraints = [
      sdk.where(
        "createdAt",
        ">",
        sdk.Timestamp.fromMillis(scanStartedAt - POST_LIFETIME_MS),
      ),
      sdk.where("createdAt", "<=", sdk.Timestamp.fromMillis(scanStartedAt)),
      sdk.orderBy("createdAt", "asc"),
      sdk.limit(POSTS_PAGE_SIZE),
    ];
    let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
    let selected: BatteryPost | null = null;
    let excludedFallback: BatteryPost | null = null;
    let count = 0;
    while (true) {
      const page = await sdk.getDocsFromServer(
        sdk.query(
          posts,
          ...baseConstraints,
          ...(cursor ? [sdk.startAfter(cursor)] : []),
        ),
      );
      for (const snapshot of page.docs) {
        const post = parseLivePost(snapshot.id, snapshot.data());
        if (!post || !isActivePost(post)) continue;
        if (post.id === excludeId) {
          excludedFallback = post;
          continue;
        }
        // Reservoir sampling: every eligible document has the same 1/N chance.
        count += 1;
        if (Math.random() < 1 / count) selected = post;
      }
      if (page.size < POSTS_PAGE_SIZE) break;
      cursor = page.docs[page.docs.length - 1];
    }
    const result = selected ?? excludedFallback;
    // A slow scan cannot leak a post that expired while the remaining pages loaded.
    if (result && !isActivePost(result)) {
      throw new Error(
        "読み込み中に投稿の表示期限が過ぎました。もう一度お試しください。",
      );
    }
    return result;
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) throw error;
    throw new Error(
      "充電を読み込めませんでした。通信環境を確認して、もう一度お試しください。",
      { cause: error },
    );
  }
}

function confirmedPost(
  snapshot: DocumentSnapshot<DocumentData>,
  attempt: LiveSubmissionAttempt,
): BatteryPost | null {
  if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) return null;
  const post = parseLivePost(snapshot.id, snapshot.data());
  return post &&
    post.id === attempt.reference?.id &&
    post.percentage === attempt.percentage &&
    post.anonymousName === attempt.anonymousName &&
    isActivePost(post)
    ? post
    : null;
}

async function executeLiveSubmission(
  attempt: LiveSubmissionAttempt,
): Promise<BatteryPost> {
  try {
    if (!attempt.reference || !attempt.sdk) {
      const [{ db }, sdk] = await Promise.all([
        getFirebaseServices(),
        import("firebase/firestore"),
      ]);
      attempt.sdk = sdk;
      attempt.reference = sdk.doc(sdk.collection(db, POSTS_COLLECTION));
    }
    const { sdk, reference } = attempt;
    if (!attempt.acknowledged) {
      await sdk.setDoc(reference, {
        percentage: attempt.percentage,
        createdAt: sdk.serverTimestamp(),
        // Firestore has no serverTimestamp()+duration client transform. Rules
        // allow ±5 minutes around server-now+24h; display still clamps to 24h.
        expiresAt: sdk.Timestamp.fromMillis(Date.now() + POST_LIFETIME_MS),
        anonymousName: attempt.anonymousName,
      });
      attempt.acknowledged = true;
    }

    let post: BatteryPost | null = null;
    try {
      // setDoc resolves only after the server acknowledges the write. Prefer its
      // resolved timestamp already in the explicitly memory-only Firestore cache.
      post = confirmedPost(await sdk.getDocFromCache(reference), attempt);
    } catch {
      // The default eager memory GC may have evicted an unobserved document.
      // Fall back to reading THIS reference, never to creating another post.
    }
    if (!post)
      post = confirmedPost(await sdk.getDocFromServer(reference), attempt);
    if (!post) {
      throw new Error(
        "確定した投稿情報を確認できません。端末の日時設定も確認してください。",
      );
    }
    if (liveSubmissionAttempt === attempt) liveSubmissionAttempt = undefined;
    return post;
  } catch (error) {
    if (attempt.acknowledged) {
      throw new Error(
        "投稿は保存されていますが、表示情報を確認できませんでした。同じ残量でもう一度お試しください。新しい投稿は作成せず、先ほどの投稿を確認します。",
        { cause: error },
      );
    }
    if (liveSubmissionAttempt === attempt) liveSubmissionAttempt = undefined;
    if (error instanceof FirebaseConfigurationError) throw error;
    throw new Error(
      "投稿を確認できませんでした。通信環境と端末の日時設定を確認してください。",
      { cause: error },
    );
  } finally {
    attempt.inFlight = undefined;
  }
}

export async function submitPost(percentage: number): Promise<BatteryPost> {
  assertPercentage(percentage);
  const mode = getAppMode();
  if (mode === "misconfigured") throw new FirebaseConfigurationError();
  if (mode === "demo") {
    const createdAt = Date.now();
    const post: BatteryPost = {
      id: `demo-post-${globalThis.crypto.randomUUID()}`,
      percentage,
      createdAt,
      expiresAt: createdAt + POST_LIFETIME_MS,
      anonymousName: generateAnonymousName(),
      source: "demo",
    };
    saveDemoPost(post);
    return post;
  }

  if (
    liveSubmissionAttempt &&
    liveSubmissionAttempt.percentage !== percentage
  ) {
    throw new Error(
      `前の投稿の確認中です。先ほどの${liveSubmissionAttempt.percentage}%のまま、もう一度確認してください。`,
    );
  }
  const attempt = liveSubmissionAttempt ?? {
    percentage,
    anonymousName: generateAnonymousName(),
    acknowledged: false,
  };
  liveSubmissionAttempt = attempt;
  // Concurrent calls for the same pending action join one write/confirmation.
  // A later call after successful completion is a new, explicit submission.
  attempt.inFlight ??= executeLiveSubmission(attempt);
  return attempt.inFlight;
}
