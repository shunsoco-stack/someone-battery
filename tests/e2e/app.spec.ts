import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type PrivacyWindow = Window & {
  __privacyApiCalls?: string[];
  __copiedText?: string;
  __clipboardCalls?: number;
};

const historyKey = "someone-battery:history:demo:v1";
const liveHistoryKey = "someone-battery:history:live:v1";
const demoPostsKey = "someone-battery:demo-posts:v1";
const viewer = (page: Page) => page.getByRole("region", { name: "誰かの充電表示", exact: true });
const history = (page: Page) => page.locator("#history");
const postDialog = (page: Page) => page.getByRole("dialog", { name: "自分の充電を投稿する", exact: true });

async function openPost(page: Page) {
  await page.getByRole("button", { name: "自分の充電を置いていく", exact: true }).click();
  const dialog = postDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.beforeEach(async ({ page }) => {
  // Keep automated interactions out of the real analytics dashboard, including
  // when PLAYWRIGHT_BASE_URL points to the published demo.
  await page.route("**/api/analytics", (route) => route.fulfill({ status: 202, body: "" }));
  await page.addInitScript(() => {
    const state = window as PrivacyWindow;
    const calls: string[] = [];
    state.__privacyApiCalls = calls;
    Object.defineProperty(navigator, "getBattery", {
      configurable: true,
      value: () => { calls.push("battery"); throw new Error("Battery access is forbidden"); },
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: () => { calls.push("location"); },
        watchPosition: () => { calls.push("location"); },
      },
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  // Fail before ANY post action if a live or partially configured deployment is
  // accidentally selected. This suite never writes to real Firestore.
  await expect(viewer(page).getByText("デモモード", { exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) {
    expect(await page.evaluate(() => (window as PrivacyWindow).__privacyApiCalls)).toEqual([]);
  }
});

test("top screen clearly distinguishes demo samples and never invents a live reading", async ({ page }) => {
  await expect(page).toHaveTitle(/誰かの充電/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("名前も知らない誰かの、");
  await expect(viewer(page).getByText("表示はすべてサンプルです。実際の投稿ではありません。")).toBeVisible();
  await expect(viewer(page).getByRole("img", { name: "まだ充電残量は表示されていません", exact: true })).toBeVisible();
  await expect(page.getByText("あなたのバッテリーを、自動で取得することはありません。")).toBeVisible();
  await expect(page.getByRole("button", { name: "誰かの充電を見る", exact: true })).toBeEnabled();
  await expect(history(page).getByText("小さな出会いは、ここに。")).toBeVisible();
});

test("random viewing shows relative time and persists only demo history across reloads", async ({ page }) => {
  await page.getByRole("button", { name: "誰かの充電を見る", exact: true }).click();
  const reading = viewer(page).getByRole("img", { name: /^充電残量 \d+%$/ });
  await expect(reading).toBeVisible();
  const label = await reading.getAttribute("aria-label");
  await expect(viewer(page).locator("time")).toHaveText(/^\d+分前$/);
  await expect(history(page).getByRole("button", { name: /をもう一度見る$/ })).toHaveCount(1);
  const stored = await page.evaluate(({ demo, live }) => ({
    demo: JSON.parse(localStorage.getItem(demo) ?? "[]"), live: localStorage.getItem(live),
  }), { demo: historyKey, live: liveHistoryKey });
  expect(stored.demo).toHaveLength(1);
  expect(stored.demo[0].source).toBe("demo");
  expect(stored.live).toBeNull();
  await page.reload({ waitUntil: "networkidle" });
  const revisit = history(page).getByRole("button", { name: /をもう一度見る$/ });
  await expect(revisit).toHaveCount(1);
  await revisit.click();
  await expect(viewer(page).getByRole("img", { name: label ?? "", exact: true })).toBeVisible();
});

test("8% worries and 100% celebrates while keeping the demo label visible", async ({ page }) => {
  await page.getByRole("button", { name: "低残量 8%", exact: true }).click();
  await expect(viewer(page).getByRole("img", { name: "充電残量 8%", exact: true })).toHaveClass(/mood-low/);
  await expect(viewer(page).getByText("だれか、充電器を。", { exact: true })).toBeVisible();
  await expect(viewer(page).getByText("充電を忘れたペンギン", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "満充電 100%", exact: true }).click();
  await expect(viewer(page).getByRole("img", { name: "充電残量 100%", exact: true })).toHaveClass(/mood-full/);
  await expect(viewer(page).getByText("100%。もはや、発電所。", { exact: true })).toBeVisible();
  await expect(viewer(page).getByText("デモモード", { exact: true })).toBeVisible();
  await expect(history(page).getByRole("button", { name: /をもう一度見る$/ })).toHaveCount(2);
});

test("keyboard slider endpoints and number input stay synchronized", async ({ page }) => {
  const dialog = await openPost(page);
  const number = dialog.getByRole("spinbutton", { name: "あなたのいまの充電残量", exact: true });
  const slider = dialog.getByRole("slider", { name: "充電残量をスライダーで選ぶ", exact: true });
  await expect(number).toHaveValue("50");
  await slider.focus();
  await slider.press("Home");
  await expect(number).toHaveValue("0");
  await expect(slider).toHaveAttribute("aria-valuetext", "0パーセント");
  await slider.press("End");
  await expect(number).toHaveValue("100");
  await slider.press("ArrowLeft");
  await expect(number).toHaveValue("99");
  await number.fill("42");
  await expect(slider).toHaveValue("42");
  await expect(number).toHaveAttribute("aria-invalid", "false");
});

test("negative, over-100, fractional and empty values cannot be posted", async ({ page }) => {
  const dialog = await openPost(page);
  const number = dialog.getByRole("spinbutton");
  const submit = dialog.getByRole("button", { name: "デモ投稿する", exact: true });
  for (const value of ["-1", "101", "1.5", ""]) {
    await number.fill(value);
    await expect(number).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText("0〜100の整数を入力してください。", { exact: true })).toBeVisible();
    await expect(submit).toBeDisabled();
    await number.press("Enter");
    await expect(dialog.getByTestId("post-success")).not.toBeVisible();
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), demoPostsKey)).toBeNull();
});

for (const amount of [0, 100]) {
  test(`${amount}% can be posted locally and completion explicitly says it is not published`, async ({ page }) => {
    const firebaseRequests: string[] = [];
    page.on("request", (request) => {
      if (/firestore\.googleapis\.com|identitytoolkit\.googleapis\.com/.test(request.url())) firebaseRequests.push(request.url());
    });
    const dialog = await openPost(page);
    await dialog.getByRole("spinbutton").fill(String(amount));
    await dialog.getByRole("button", { name: "デモ投稿する", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "デモ投稿が完了しました。", exact: true })).toBeVisible();
    await expect(dialog.getByText("これはデモです。この端末にだけ保存され、実際には公開されません。", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("img", { name: `充電残量 ${amount}%`, exact: true })).toBeVisible();
    const posts = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), demoPostsKey);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ percentage: amount, source: "demo" });
    expect(Object.keys(posts[0]).sort()).toEqual(["anonymousName", "createdAt", "expiresAt", "id", "percentage", "source"]);
    expect(firebaseRequests).toEqual([]);
    await dialog.getByRole("button", { name: "充電を眺めに戻る" }).click();
    await expect(dialog).not.toBeVisible();
  });
}

test("modal keeps keyboard focus inside and Escape restores the trigger", async ({ page }) => {
  const opener = page.getByRole("button", { name: "自分の充電を置いていく", exact: true });
  await opener.focus();
  await opener.press("Enter");
  const dialog = postDialog(page);
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 9; index++) {
    await page.keyboard.press("Tab");
    const focus = await dialog.evaluate((element) => ({
      inside: element.contains(document.activeElement),
      tag: document.activeElement?.tagName,
      label: document.activeElement?.getAttribute("aria-label"),
      id: document.activeElement?.id,
    }));
    expect(focus.inside, `Tab ${index + 1} moved focus outside the modal: ${JSON.stringify(focus)}`).toBe(true);
  }
  for (let index = 0; index < 9; index++) {
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement)), `Shift+Tab ${index + 1} escaped the modal`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test("theme changes persist across reloads", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "ライトモードに切り替える", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "ダークモードに切り替える", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("history can be cleared without reappearing on reload", async ({ page }) => {
  await page.getByRole("button", { name: "低残量 8%", exact: true }).click();
  await page.getByRole("button", { name: "満充電 100%", exact: true }).click();
  await expect(history(page).getByRole("button", { name: /をもう一度見る$/ })).toHaveCount(2);
  await history(page).getByRole("button", { name: "履歴を消す", exact: true }).click();
  await expect(history(page).getByText("小さな出会いは、ここに。", { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(history(page).getByRole("button", { name: /をもう一度見る$/ })).toHaveCount(0);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), historyKey)).toEqual([]);
});

test("a viewed post expires from both the active display and local history after 24 hours", async ({ page }) => {
  await page.clock.install({ time: Date.now() });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "低残量 8%", exact: true }).click();
  await expect(viewer(page).getByRole("img", { name: "充電残量 8%", exact: true })).toBeVisible();
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await expect(viewer(page).getByRole("heading", { name: "この充電は、旅を終えました。", exact: true })).toBeVisible();
  await expect(viewer(page).getByRole("img", { name: "充電残量 8%", exact: true })).not.toBeVisible();
  await expect(history(page).getByRole("button", { name: /をもう一度見る$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "この充電を共有する", exact: true })).not.toBeVisible();
});

test("a completion screen stops displaying and sharing its expired post", async ({ page }) => {
  await page.clock.install({ time: Date.now() });
  await page.reload({ waitUntil: "networkidle" });
  const dialog = await openPost(page);
  await dialog.getByRole("spinbutton").fill("100");
  await dialog.getByRole("button", { name: "デモ投稿する", exact: true }).click();
  await expect(dialog.getByTestId("post-success")).toBeVisible();
  await page.clock.fastForward(24 * 60 * 60 * 1000 + 1000);
  await expect(dialog.getByRole("heading", { name: "この充電は、旅を終えました。", exact: true })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "充電残量 100%", exact: true })).not.toBeVisible();
  await expect(dialog.getByRole("button", { name: "この気持ちをシェア", exact: true })).not.toBeVisible();
});

test("clipboard share fallback includes the demo prefix and canonical origin only", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { (window as PrivacyWindow).__copiedText = text; },
    } });
  });
  await page.getByRole("button", { name: "低残量 8%", exact: true }).click();
  await page.getByRole("button", { name: "この充電を共有する", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "共有文とリンクをコピーしました。" })).toBeVisible();
  const copied = await page.evaluate(() => (window as PrivacyWindow).__copiedText);
  expect(copied).toContain("【デモ】充電を忘れたペンギンの充電は8%。");
  expect(copied).toContain(`${new URL(page.url()).origin}/`);
  expect(copied).not.toContain("?percentage=");
});

test("cancelling native sharing does not copy anything", async ({ page }) => {
  await page.evaluate(() => {
    const state = window as PrivacyWindow;
    state.__clipboardCalls = 0;
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new DOMException("Cancelled", "AbortError"); } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { state.__clipboardCalls = (state.__clipboardCalls ?? 0) + 1; },
    } });
  });
  await page.getByRole("button", { name: "低残量 8%", exact: true }).click();
  await page.getByRole("button", { name: "この充電を共有する", exact: true }).click();
  await expect(page.getByText("共有文とリンクをコピーしました。", { exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => (window as PrivacyWindow).__clipboardCalls)).toBe(0);
});

test("manual share text remains available when native share and clipboard are unavailable", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new Error("Clipboard unavailable"); },
    } });
  });
  await page.getByRole("button", { name: "低残量 8%", exact: true }).click();
  await page.getByRole("button", { name: "この充電を共有する", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "充電を共有する", exact: true });
  await expect(dialog).toBeVisible();
  const text = dialog.getByRole("textbox", { name: "共有文とリンク", exact: true });
  await expect(text).toHaveValue(/【デモ】充電を忘れたペンギンの充電は8%。/);
  await expect(text).toHaveAttribute("readonly", "");
  await dialog.getByRole("button", { name: "共有文を選択する", exact: true }).click();
  expect(await text.evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart === element.value.length)).toBe(true);
});

test("320px and 390px screens do not overflow, including viewing and posting", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
    await page.getByRole("button", { name: "満充電 100%", exact: true }).click();
    await noOverflow(page);
    const dialog = await openPost(page);
    await noOverflow(page);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  }
});

for (const theme of ["dark", "light"] as const) {
  test(`axe WCAG checks pass for the ${theme} home and post dialog`, async ({ page }) => {
    if (theme === "light") await page.getByRole("button", { name: "ライトモードに切り替える", exact: true }).click();
    const check = async () => {
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(result.violations).toEqual([]);
    };
    await check();
    await page.getByRole("button", { name: "低残量 8%", exact: true }).click();
    await check();
    const dialog = await openPost(page);
    await check();
    await dialog.getByRole("spinbutton").fill("0");
    await dialog.getByRole("button", { name: "デモ投稿する", exact: true }).click();
    await expect(dialog.getByTestId("post-success")).toBeVisible();
    await check();
  });
}

test("manifest, icons, OG image and service-worker assets are published", async ({ page, request }) => {
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const response = await request.get(new URL(href!, page.url()).toString());
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "誰かの充電", lang: "ja", start_url: "/", scope: "/", display: "standalone" });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
  ]));
  for (const icon of manifest.icons as Array<{ src: string }>) expect((await request.get(new URL(icon.src, page.url()).toString())).ok()).toBe(true);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og\.png$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  for (const asset of ["/og.png", "/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/sw.js", "/offline.html"]) {
    expect((await request.get(new URL(asset, page.url()).toString())).ok(), asset).toBe(true);
  }
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /width=device-width/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
});
