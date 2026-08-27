import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { AppMode } from "./battery";

function getPublicConfig() {
  // Next.js only inlines explicit NEXT_PUBLIC_ property accesses at build time.
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() ?? "",
  };
}

/** A broken/partial live configuration must NEVER silently become demo data. */
export function getAppMode(): AppMode {
  const configured = Object.values(getPublicConfig()).filter(Boolean).length;
  if (configured === 0) return "demo";
  if (configured === 4) return "live";
  return "misconfigured";
}

export class FirebaseConfigurationError extends Error {
  constructor() {
    super(
      "Firebaseの設定が完了していません。管理者が設定を確認するまで、投稿・閲覧は利用できません。",
    );
    this.name = "FirebaseConfigurationError";
  }
}

interface FirebaseServices {
  auth: Auth;
  db: Firestore;
}

const APP_NAME = "someone-battery";
let servicesPromise: Promise<FirebaseServices> | undefined;
let signInPromise: Promise<void> | undefined;

async function initializeServices(): Promise<FirebaseServices> {
  const [appSdk, authSdk, firestoreSdk] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
    import("firebase/firestore"),
  ]);
  const app =
    appSdk.getApps().find((existing) => existing.name === APP_NAME) ??
    appSdk.initializeApp(getPublicConfig(), APP_NAME);

  let auth: Auth;
  try {
    auth = authSdk.initializeAuth(app, {
      persistence: authSdk.inMemoryPersistence,
    });
  } catch (error) {
    // Next.js hot reload can retain an already initialized app/auth pair.
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "auth/already-initialized"
    ) {
      throw error;
    }
    auth = authSdk.getAuth(app);
    await authSdk.setPersistence(auth, authSdk.inMemoryPersistence);
  }

  // getFirestore defaults to memory-only cache; never enable IndexedDB persistence.
  return { auth, db: firestoreSdk.getFirestore(app) };
}

/** Called only by explicit view/post actions, never merely by rendering the page. */
export async function getFirebaseServices(): Promise<FirebaseServices> {
  if (getAppMode() !== "live") throw new FirebaseConfigurationError();
  if (!servicesPromise) {
    servicesPromise = initializeServices().catch((error: unknown) => {
      servicesPromise = undefined;
      throw error;
    });
  }
  const services = await servicesPromise;
  if (!services.auth.currentUser) {
    if (!signInPromise) {
      signInPromise = import("firebase/auth")
        .then(async ({ signInAnonymously }) => {
          await signInAnonymously(services.auth);
        })
        .finally(() => {
          signInPromise = undefined;
        });
    }
    await signInPromise;
  }
  if (!services.auth.currentUser?.isAnonymous) {
    throw new Error(
      "匿名認証を確認できませんでした。ページを再読み込みしてください。",
    );
  }
  return services;
}
