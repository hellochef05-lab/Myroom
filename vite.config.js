import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "admin-manifest.webmanifest",
        "admin-apple-touch-icon.png",
        "admin-favicon-32x32.png",
        "admin-favicon.ico",
        "admin-pwa-192x192.png",
        "admin-pwa-512x512.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
      ],

      manifest: {
        name: "SayUp",
        short_name: "SayUp",
        description:
          "SayUp conversations, calls, media sharing and support.",

        theme_color: "#075e54",
        background_color: "#efeae2",

        display: "standalone",
        orientation: "portrait-primary",

        start_url: "/",
        scope: "/",

        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },

      workbox: {
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,

        // API requests must bypass Workbox. Wrapping Render requests in a
        // NetworkOnly route turns a temporary cold start into noisy rejected
        // worker promises and duplicates the application's own retry logic.
        runtimeCaching: [],
      },

devOptions: {
  enabled: false,
},
    }),
    {
      name: "admin-manifest-isolation",
      enforce: "post",
      transformIndexHtml: {
        order: "post",
        handler(html, context) {
          if (!context.filename?.endsWith("/admin/index.html")) return html;
          return html.replace(
            '<link rel="manifest" href="/manifest.webmanifest">',
            ""
          );
        },
      },
    },
  ],
  build: {
    // Stream's complete messaging UI is intentionally isolated from the
    // lightweight SayUp shell; its vendor chunk is large but independently
    // cached and no longer inflates the application entry bundle.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./admin/index.html", import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes("stream-chat-react")) return "chat-ui-vendor";
          if (id.includes("/node_modules/stream-chat/")) return "chat-core-vendor";
          if (id.includes("@daily-co")) return "call-vendor";
          return undefined;
        },
      },
    },
  },
});
