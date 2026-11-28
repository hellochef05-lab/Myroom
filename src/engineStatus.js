export const ENGINE_UNAVAILABLE = "Sayup is unavailable right now.";

export async function readEngineStatus(apiBase) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${apiBase.replace(/\/+$/, "")}/api/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const status = await response.json();
    return status.success === true && status.database === "connected"
      ? status.engineEnabled !== false
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
