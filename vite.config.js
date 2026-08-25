import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
      ],

      manifest: {
        name: "Private Room",
        short_name: "Private Room",
        description:
          "Private chat rooms, calls, media sharing and support.",

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

        runtimeCaching: [
          {
            urlPattern: /^https:\/\/myroom-ms7g\.onrender\.com\/api\//,

            handler: "NetworkOnly",

            options: {
              cacheName: "private-room-api",
            },
          },
        ],
      },

      devOptions: {
  enabled: false,
},
    }),
  ],
});
