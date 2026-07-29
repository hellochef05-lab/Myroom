import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          stream: ["stream-chat", "stream-chat-react"],
          socket: ["socket.io-client"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});