import { next } from "@vercel/functions";
import { ENGINE_NAVIGATION_METRIC, ENGINE_UNAVAILABLE, readEngineStatus } from "./src/engineStatus.js";

export const config = { matcher: ["/((?!assets/|api/|sw\\.js|workbox-|registerSW\\.js|favicon|apple-touch-icon|admin-).*)"] };

export default async function middleware(request) {
  const { hostname, pathname } = new URL(request.url);
  if (hostname === "sayup-admin.vercel.app" || pathname.replace(/\/+$/, "") === "/admin") return next();
  const destination = request.headers.get("sec-fetch-dest");
  if (destination && destination !== "document" && destination !== "iframe") return next();
  const apiBase = process.env.VITE_API_BASE_URL || "https://myroom-ms7g.onrender.com";
  if (await readEngineStatus(apiBase) === true) {
    return next({
      headers: {
        "Server-Timing": `${ENGINE_NAVIGATION_METRIC};desc="on"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sayup unavailable</title><main style="max-width:34rem;margin:12vh auto;padding:1.5rem;font:1rem system-ui,sans-serif"><h1>${ENGINE_UNAVAILABLE}</h1><p><a href="/">Try again</a></p></main></html>`, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "15" },
  });
}
