import { useEffect, useState } from "react";
import { ENGINE_UNAVAILABLE, readEngineStatus, wasEngineVerifiedForNavigation } from "./engineStatus.js";

const STARTUP_TIMEOUT_MS = 75_000;
const STARTUP_RETRY_MS = 5_000;
const STATUS_REFRESH_MS = 15_000;

export default function PublicEngineGate({ apiBase, children }) {
  const [verifiedOnNavigation] = useState(() => wasEngineVerifiedForNavigation(window.performance));
  const [status, setStatus] = useState(verifiedOnNavigation ? "on" : "checking");

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let revision = 0;
    let knownStatus = verifiedOnNavigation;
    let timer;

    const scheduleRefresh = (delay) => {
      clearTimeout(timer);
      timer = setTimeout(refresh, delay);
    };

    const turnOff = () => {
      revision++;
      knownStatus = true;
      setStatus("off");
      if (!inFlight) scheduleRefresh(STATUS_REFRESH_MS);
    };

    const refresh = async () => {
      if (inFlight || document.hidden) return;
      clearTimeout(timer);
      inFlight = true;
      const startRevision = revision;
      const enabled = await readEngineStatus(apiBase, knownStatus ? undefined : STARTUP_TIMEOUT_MS);
      inFlight = false;
      if (cancelled) return;
      if (startRevision === revision && enabled !== null) {
        knownStatus = true;
        setStatus(enabled ? "on" : "off");
      }
      scheduleRefresh(knownStatus ? STATUS_REFRESH_MS : STARTUP_RETRY_MS);
    };

    const refreshRestoredPage = (event) => {
      if (event.persisted) void refresh();
    };
    if (verifiedOnNavigation) scheduleRefresh(STATUS_REFRESH_MS);
    else void refresh();

    window.addEventListener("online", refresh);
    window.addEventListener("sayup:engine-off", turnOff);
    window.addEventListener("pageshow", refreshRestoredPage);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("sayup:engine-off", turnOff);
      window.removeEventListener("pageshow", refreshRestoredPage);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [apiBase, verifiedOnNavigation]);

  if (status === "on") return children;
  return (
    <main style={{ maxWidth: "34rem", margin: "12vh auto", padding: "1.5rem" }} aria-live="polite">
      <h1>{status === "checking" ? "Connecting to Sayup…" : ENGINE_UNAVAILABLE}</h1>
      {status === "checking" && <p>The server may take a moment to wake up. Sayup will keep trying.</p>}
      {status === "off" && <a href="/">Try again</a>}
    </main>
  );
}
