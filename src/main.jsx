import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

const isAdminRoute = window.location.pathname === "/admin";

if (isAdminRoute) {
  document.documentElement.classList.add("private-room-admin-active");
  document.body.classList.add("private-room-admin-active");
  document.title = "Private Room Admin";

  const manifestLink =
    document.querySelector('link[rel="manifest"]') ||
    document.head.appendChild(document.createElement("link"));
  manifestLink.setAttribute("rel", "manifest");
  manifestLink.setAttribute("href", "/admin-manifest.webmanifest");

  const appTitle = document.querySelector(
    'meta[name="apple-mobile-web-app-title"]'
  );
  appTitle?.setAttribute("content", "Room Admin");

  const themeColor = document.querySelector('meta[name="theme-color"]');
  themeColor?.setAttribute("content", "#0f766e");
}

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
