import { useEffect, useState } from "react";
import { ENGINE_UNAVAILABLE, readEngineStatus } from "./engineStatus.js";

export default function PublicEngineGate({ apiBase, children }) {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let revision = 0;
    const turnOff = () => {
      revision++;
      setStatus("off");
    };
    const refresh = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const startRevision = revision;
      const enabled = await readEngineStatus(apiBase);
      inFlight = false;
      if (cancelled || startRevision !== revision) return;
      setStatus(current => enabled === null ? (current === "on" ? current : "off") : enabled ? "on" : "off");
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("online", refresh);
    window.addEventListener("sayup:engine-off", turnOff);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("sayup:engine-off", turnOff);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [apiBase]);

  if (status === "on") return children;
  return (
    <main style={{ maxWidth: "34rem", margin: "12vh auto", padding: "1.5rem" }} aria-live="polite">
      <h1>{status === "checking" ? "Connecting to Sayup…" : ENGINE_UNAVAILABLE}</h1>
      {status === "off" && <a href="/">Try again</a>}
    </main>
  );
}
