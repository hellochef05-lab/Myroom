import { next } from "@vercel/functions";
import { ENGINE_NAVIGATION_METRIC, ENGINE_UNAVAILABLE, readEngineStatus } from "./src/engineStatus.js";

export const config = { matcher: ["/((?!assets/|api/|sw\\.js|workbox-|registerSW\\.js|favicon|apple-touch-icon|admin-).*)"] };

export default async function middleware(request) {
  const { hostname, pathname } = new URL(request.url);
  if (hostname === "sayup-admin.vercel.app" || pathname.replace(/\/+$/, "") === "/admin") return next();
  const destination = request.headers.get("sec-fetch-dest");
  if (destination && destination !== "document" && destination !== "iframe") return next();
  const apiBase = process.env.VITE_API_BASE_URL || "https://myroom-ms7g.onrender.com";
  const enabled = await readEngineStatus(apiBase);
  if (enabled !== false) {
    const headers = new Headers({ "Cache-Control": "no-store" });
    // Only mark verified pages. Otherwise the browser renders the connecting
    // screen until it can confirm that the Engine is on.
    if (enabled === true) headers.set("Server-Timing", `${ENGINE_NAVIGATION_METRIC};desc="on"`);
    return next({ headers });
  }

  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sayup unavailable</title><main style="max-width:34rem;margin:12vh auto;padding:1.5rem;font:1rem system-ui,sans-serif"><h1>${ENGINE_UNAVAILABLE}</h1><p><a href="/">Try again</a></p></main></html>`, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "15" },
  });
}
