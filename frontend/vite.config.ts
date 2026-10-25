/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the FastAPI server (uvicorn on :8000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.API_PROXY ?? "http://127.0.0.1:8000" },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { charts: ["recharts"] } }, // keep the big chart lib in its own cacheable file
    },
  },
  test: { environment: "node" },
});
