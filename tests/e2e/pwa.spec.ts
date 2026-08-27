import { expect, test, type Page } from "@playwright/test";

const allowedStaticPaths = ["/favicon.svg", "/icon-192.png", "/icon-512.png", "/offline.html"];
const demoHistoryKey = "someone-battery:history:demo:v1";

async function cacheInventory(page: Page) {
  return page.evaluate(async () => {
    const inventory: Array<{ cache: string; path: string; query: string; method: string; status: number; sameOrigin: boolean }> = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        const response = await cache.match(request);
        inventory.push({
          cache: name, path: url.pathname, query: url.search,
          method: request.method, status: response?.status ?? 0,
          sameOrigin: url.origin === location.origin,
        });
      }
    }
    return inventory.sort((a, b) => a.path.localeCompare(b.path));
  });
}

test("production PWA registers, serves an offline page, reconnects and caches only public static assets", async ({ browser, baseURL }, testInfo) => {
  test.skip(process.env.PLAYWRIGHT_TEST_PWA !== "1", "Explicitly set PLAYWRIGHT_TEST_PWA=1 against a production demo; development intentionally does not register a service worker.");
  test.setTimeout(60_000);
  expect(baseURL).toBeTruthy();

  // This private test context has no inherited login, existing service worker,
  // cookies, clipboard state, or storage. It never modifies a user's browser.
  const context = await browser.newContext({
    baseURL, locale: "ja-JP", serviceWorkers: "allow", colorScheme: "dark",
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const firebaseRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname === "firestore.googleapis.com" || url.hostname === "identitytoolkit.googleapis.com") {
        firebaseRequests.push(url.hostname);
      }
    });

    await page.goto("/", { waitUntil: "networkidle" });
    const viewer = page.getByRole("region", { name: "誰かの充電表示", exact: true });
    await expect(viewer.getByText("デモモード", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      message: "The application's production service worker should control this page",
      timeout: 20_000,
    }).toBe(true);
    const registration = await page.evaluate(async () => {
      const active = await navigator.serviceWorker.getRegistration("/");
      return { script: active?.active?.scriptURL, state: active?.active?.state, scope: active?.scope };
    });
    expect(registration.state).toBe("activated");
    expect(registration.script).toBe(`${new URL(page.url()).origin}/sw.js`);
    expect(registration.scope).toBe(`${new URL(page.url()).origin}/`);

    // Exercise real demo interactions before checking that none of their data is
    // written to CacheStorage. Local history/demo posts are a separate feature.
    await page.getByRole("button", { name: "低残量 8%", exact: true }).click();
    await page.getByRole("button", { name: "自分の充電を置いていく", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "自分の充電を投稿する", exact: true });
    await dialog.getByRole("spinbutton").fill("37");
    await dialog.getByRole("button", { name: "デモ投稿する", exact: true }).click();
    await expect(dialog.getByText("これはデモです。この端末にだけ保存され、実際には公開されません。", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "充電を眺めに戻る" }).click();

    // The published demo has analytics explicitly disabled. A valid request can
    // be accepted/validated without a provider event, and must be no-store.
    const responses = await page.evaluate(async () => {
      const analytics = await fetch("/api/analytics", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "battery_view", mode: "demo" }),
        credentials: "omit", referrerPolicy: "no-referrer",
      });
      const unsupportedMethod = await fetch("/api/analytics", { credentials: "omit" });
      const documentResponse = await fetch("/", { cache: "no-store", credentials: "omit" });
      return {
        analytics: analytics.status,
        analyticsCacheControl: analytics.headers.get("cache-control"),
        unsupportedMethod: unsupportedMethod.status,
        document: documentResponse.status,
      };
    });
    expect(responses).toMatchObject({ analytics: 202, analyticsCacheControl: "no-store", unsupportedMethod: 405, document: 200 });

    const beforeOffline = await cacheInventory(page);
    expect(beforeOffline.map((entry) => entry.path)).toEqual(allowedStaticPaths);
    for (const entry of beforeOffline) {
      expect(entry).toMatchObject({ cache: "someone-battery-static-v1", query: "", method: "GET", status: 200, sameOrigin: true });
    }
    expect(beforeOffline.some((entry) => /\/api\/|auth|firestore|batteryPosts/.test(entry.path))).toBe(false);
    expect(beforeOffline.some((entry) => entry.path === "/")).toBe(false);

    await context.setOffline(true);
    const offlineResponse = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(offlineResponse?.status()).toBe(200);
    await expect(page).toHaveTitle("オフライン | 誰かの充電");
    await expect(page.getByRole("heading", { name: "いまは、ちょっとひと休み。", exact: true })).toBeVisible();
    await expect(page.getByText("オフライン中は投稿・新しい残量の取得はできません。", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "デモ投稿する", exact: true })).not.toBeVisible();
    const offlineHistory = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), demoHistoryKey);
    expect(offlineHistory).toHaveLength(1);
    expect(offlineHistory[0]).toMatchObject({ percentage: 8, source: "demo" });
    expect(await cacheInventory(page)).toEqual(beforeOffline);

    await context.setOffline(false);
    await page.getByRole("link", { name: "もう一度つないでみる", exact: true }).click();
    await expect(viewer.getByText("デモモード", { exact: true })).toBeVisible();
    await expect(page.locator("#history").getByRole("button", { name: "充電を忘れたペンギン、8%をもう一度見る", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "誰かの充電を見る", exact: true })).toBeEnabled();
    expect(await cacheInventory(page)).toEqual(beforeOffline);
    expect(firebaseRequests).toEqual([]);

    await testInfo.attach("public-pwa-cache-audit", {
      contentType: "application/json",
      body: JSON.stringify({ registration, responses, cacheEntries: beforeOffline, offlineFallback: "passed", onlineRecovery: "passed", firebaseRequests: 0 }, null, 2),
    });
  } finally {
    await context.setOffline(false);
    await context.close();
  }
});
