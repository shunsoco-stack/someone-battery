import { track } from "@vercel/analytics/server";
import { after } from "next/server";

const events = new Set([
  "page_view",
  "battery_view",
  "battery_post",
  "battery_share",
]);
const response = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const url = new URL(request.url);
  // Do not let an arbitrary URL/query/referrer become analytics data.
  if (url.search || request.headers.get("origin") !== url.origin)
    return response(403);
  if (
    request.headers.get("dnt") === "1" ||
    request.headers.get("sec-gpc") === "1"
  )
    return response(204);
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return response(415);
  if (Number(request.headers.get("content-length")) > 256) return response(413);

  try {
    const reader = request.body?.getReader();
    if (!reader) return response(400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 256) {
        await reader.cancel();
        return response(413);
      }
      chunks.push(value);
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return response(400);
    const values = payload as Record<string, unknown>;
    if (
      Object.keys(values).length !== 2 ||
      typeof values.event !== "string" ||
      !events.has(values.event) ||
      (values.mode !== "live" && values.mode !== "demo")
    )
      return response(400);

    if (
      process.env.VERCEL === "1" &&
      process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true"
    ) {
      const name = values.event;
      const mode = values.mode;
      after(async () => {
        // Construct NEW headers. Never spread request headers, IP, cookies,
        // browser, location, or Firebase identity into the analytics request.
        await track(
          name,
          { mode },
          {
            headers: {
              "user-agent": "SomeoneBattery/1.0",
              "x-forwarded-for": "0.0.0.0",
              cookie: "",
            },
          },
        );
      });
    }
    return response(202);
  } catch {
    return response(400);
  }
}
