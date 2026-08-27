import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => {
  const pending: Array<() => Promise<void>> = [];
  return {
    pending,
    after: vi.fn((callback: () => Promise<void>) => { pending.push(callback); }),
    track: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("next/server", () => ({ after: analyticsMocks.after }));
vi.mock("@vercel/analytics/server", () => ({ track: analyticsMocks.track }));

import { POST } from "@/app/api/analytics/route";
import { ANALYTICS_EVENTS, ANALYTICS_PREFERENCE_KEY, analyticsAllowed, recordEvent } from "@/lib/analytics";

const origin = "https://someone-battery.example";
const validPayload = { event: "battery_view", mode: "demo" };

function requestFor(payload: unknown = validPayload, options: { headers?: Record<string, string | undefined>; url?: string; raw?: string } = {}) {
  const headers = new Headers({ origin, "content-type": "application/json" });
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value !== undefined) headers.set(key, value);
  }
  return new Request(options.url ?? `${origin}/api/analytics`, {
    method: "POST",
    headers,
    body: options.raw ?? JSON.stringify(payload),
  });
}

async function runDeferred() {
  for (const callback of analyticsMocks.pending.splice(0)) await callback();
}

beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  // Tracking tests opt in explicitly; an unset flag must remain inactive.
  vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENABLED", "true");
  analyticsMocks.pending.length = 0;
  analyticsMocks.after.mockClear();
  analyticsMocks.track.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("anonymous analytics endpoint", () => {
  for (const event of ANALYTICS_EVENTS) {
    for (const mode of ["demo", "live"] as const) {
      it(`accepts only ${event}/${mode} and schedules tracking after responding`, async () => {
        const response = await POST(requestFor({ event, mode }));
        expect(response.status).toBe(202);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.text()).toBe("");
        expect(analyticsMocks.after).toHaveBeenCalledOnce();
        expect(analyticsMocks.track).not.toHaveBeenCalled();
        await runDeferred();
        expect(analyticsMocks.track).toHaveBeenCalledExactlyOnceWith(event, { mode }, {
          headers: {
            "user-agent": "SomeoneBattery/1.0",
            "x-forwarded-for": "0.0.0.0",
            cookie: "",
          },
        });
      });
    }
  }

  it("constructs fixed headers without forwarding IP, device, cookies, referrer, or location", async () => {
    const response = await POST(requestFor(validPayload, { headers: {
      "user-agent": "PrivateExampleDevice/99",
      "x-forwarded-for": "192.0.2.42",
      "x-real-ip": "198.51.100.23",
      "x-vercel-ip-country": "ZZ",
      "x-vercel-ip-city": "PrivateExampleCity",
      cookie: "example-session=not-a-real-session",
      referer: "https://private.example/hidden-page?private=value",
      "x-user-id": "private-example-id",
    } }));
    expect(response.status).toBe(202);
    await runDeferred();
    expect(analyticsMocks.track).toHaveBeenCalledExactlyOnceWith("battery_view", { mode: "demo" }, {
      headers: { "user-agent": "SomeoneBattery/1.0", "x-forwarded-for": "0.0.0.0", cookie: "" },
    });
    const tracked = JSON.stringify(analyticsMocks.track.mock.calls);
    for (const forbidden of ["PrivateExample", "192.0.2.42", "198.51.100.23", "example-session", "private.example", "private-example-id", "ZZ"]) {
      expect(tracked).not.toContain(forbidden);
    }
  });

  it.each([
    { origin: "https://other.example" },
    { origin: "null" },
    { origin: "" },
  ])("rejects a non-matching origin: %j", async (headers) => {
    const response = await POST(requestFor(validPayload, { headers }));
    expect(response.status).toBe(403);
    expect(analyticsMocks.after).not.toHaveBeenCalled();
  });

  it("rejects absent origin and query strings instead of reporting them", async () => {
    const noOrigin = requestFor();
    noOrigin.headers.delete("origin");
    expect((await POST(noOrigin)).status).toBe(403);
    expect((await POST(requestFor(validPayload, { url: `${origin}/api/analytics?name=private-example` }))).status).toBe(403);
    expect(analyticsMocks.after).not.toHaveBeenCalled();
  });

  it.each([{ dnt: "1" }, { "sec-gpc": "1" }])("respects privacy refusal: %j", async (headers) => {
    const response = await POST(requestFor(validPayload, { headers }));
    expect(response.status).toBe(204);
    expect(analyticsMocks.after).not.toHaveBeenCalled();
    expect(analyticsMocks.track).not.toHaveBeenCalled();
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "application/jsonp", ""]) (
    "rejects an unsupported media type: %s", async (contentType) => {
      const response = await POST(requestFor(validPayload, { headers: { "content-type": contentType } }));
      expect(response.status).toBe(415);
      expect(analyticsMocks.after).not.toHaveBeenCalled();
    },
  );

  it("accepts JSON with a charset parameter", async () => {
    expect((await POST(requestFor(validPayload, { headers: { "content-type": "application/json; charset=utf-8" } }))).status).toBe(202);
  });

  it.each([null, [], "battery_view", 8, true, {}, { event: "battery_view" }, { mode: "demo" }, { event: "other", mode: "demo" }, { event: "battery_view", mode: "misconfigured" }, { event: 3, mode: "demo" }])(
    "rejects unsupported JSON shapes: %j", async (payload) => {
      expect((await POST(requestFor(payload))).status).toBe(400);
      expect(analyticsMocks.after).not.toHaveBeenCalled();
    },
  );

  it.each(["percentage", "anonymousName", "uid", "location", "device", "referrer", "headers"])(
    "rejects an extra %s field rather than silently collecting it", async (field) => {
      expect((await POST(requestFor({ ...validPayload, [field]: "private-example" }))).status).toBe(400);
      expect(analyticsMocks.after).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON and an absent body", async () => {
    expect((await POST(requestFor(validPayload, { raw: "{" }))).status).toBe(400);
    const noBody = new Request(`${origin}/api/analytics`, { method: "POST", headers: { origin, "content-type": "application/json" } });
    expect((await POST(noBody)).status).toBe(400);
    expect(analyticsMocks.after).not.toHaveBeenCalled();
  });

  it("rejects an advertised body larger than 256 bytes", async () => {
    expect((await POST(requestFor(validPayload, { headers: { "content-length": "257" } }))).status).toBe(413);
    expect(analyticsMocks.after).not.toHaveBeenCalled();
  });

  it.each([{}, { "content-length": "1" }])("enforces the byte limit even without a trustworthy length header: %j", async (headers) => {
    const response = await POST(requestFor(validPayload, { raw: "x".repeat(257), headers }));
    expect(response.status).toBe(413);
    expect(analyticsMocks.after).not.toHaveBeenCalled();
  });

  it("counts UTF-8 bytes rather than JavaScript string length", async () => {
    const raw = JSON.stringify({ event: "あ".repeat(85), mode: "demo" });
    expect(raw.length).toBeLessThan(256);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(256);
    expect((await POST(requestFor(validPayload, { raw }))).status).toBe(413);
  });

  it("bounds chunked streams and cancels reading on overflow", async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(130).fill(120)); },
      cancel,
    });
    const init = { method: "POST", headers: { origin, "content-type": "application/json" }, body, duplex: "half" } as RequestInit;
    expect((await POST(new Request(`${origin}/api/analytics`, init))).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBeLessThanOrEqual(4);
    expect(analyticsMocks.after).not.toHaveBeenCalled();
  });

  it("does not send anything to Vercel outside the Vercel runtime", async () => {
    vi.stubEnv("VERCEL", "0");
    expect((await POST(requestFor())).status).toBe(202);
    expect(analyticsMocks.after).not.toHaveBeenCalled();
    expect(analyticsMocks.track).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "false", "TRUE", "1", "true "])(
    "does not schedule or forward server analytics without the exact opt-in value: %s", async (enabled) => {
      vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENABLED", enabled);
      const response = await POST(requestFor());
      expect(response.status).toBe(202);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(analyticsMocks.after).not.toHaveBeenCalled();
      await runDeferred();
      expect(analyticsMocks.track).not.toHaveBeenCalled();
    },
  );

  it("still validates requests when analytics is deliberately inactive", async () => {
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENABLED", "false");
    expect((await POST(requestFor({ ...validPayload, uid: "private-example" }))).status).toBe(400);
    expect((await POST(requestFor(validPayload, { headers: { origin: "https://other.example" } }))).status).toBe(403);
    expect((await POST(requestFor(validPayload, { raw: "x".repeat(257) }))).status).toBe(413);
    expect(analyticsMocks.after).not.toHaveBeenCalled();
    expect(analyticsMocks.track).not.toHaveBeenCalled();
  });
});

describe("browser analytics minimization", () => {
  function browser({ dnt = "0", gpc = false, preference = null as string | null, storageThrows = false } = {}) {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { doNotTrack: dnt, globalPrivacyControl: gpc });
    vi.stubGlobal("localStorage", { getItem: vi.fn((key: string) => {
      expect(key).toBe(ANALYTICS_PREFERENCE_KEY);
      if (storageThrows) throw new Error("Storage is disabled");
      return preference;
    }) });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("does not collect in a server context", () => {
    expect(analyticsAllowed()).toBe(false);
  });

  it.each([undefined, "", "false", "TRUE", "1", "true "])(
    "does not send browser requests without the exact opt-in value: %s", (enabled) => {
      vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENABLED", enabled);
      const fetch = browser({ preference: "on" });
      expect(analyticsAllowed()).toBe(false);
      for (const event of ANALYTICS_EVENTS) recordEvent(event, "demo");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("posts exactly the allowlisted event and mode without cookies or referrer", () => {
    const fetch = browser();
    recordEvent("battery_post", "demo");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/analytics", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "battery_post", mode: "demo" }),
      credentials: "omit", referrerPolicy: "no-referrer", keepalive: true,
    });
  });

  it.each([{ dnt: "1" }, { gpc: true }, { preference: "off" }, { storageThrows: true }])(
    "sends nothing when privacy settings refuse collection: %j", (settings) => {
      const fetch = browser(settings);
      expect(analyticsAllowed()).toBe(false);
      recordEvent("page_view", "demo");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not collect in misconfigured mode", () => {
    const fetch = browser();
    recordEvent("page_view", "misconfigured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps an analytics network failure from interrupting an interaction", async () => {
    const fetch = browser();
    fetch.mockRejectedValueOnce(new Error("Network unavailable"));
    expect(() => recordEvent("battery_share", "demo")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
