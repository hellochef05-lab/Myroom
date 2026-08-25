import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

if ("serviceWorker" in navigator) {
  const hadControllerAtLaunch = Boolean(navigator.serviceWorker.controller);
  let refreshingForUpdate = false;

  if (hadControllerAtLaunch) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshingForUpdate) return;
      refreshingForUpdate = true;
      window.location.reload();
    });
  }

  const checkForSavedAppUpdate = () => {
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.update())
      .catch(() => {});
  };

  window.addEventListener("pageshow", checkForSavedAppUpdate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForSavedAppUpdate();
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
