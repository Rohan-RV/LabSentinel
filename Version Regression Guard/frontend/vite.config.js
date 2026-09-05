import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard calls /api/* which is proxied to the FastAPI backend on :8000,
// so there is no hardcoded host and no CORS friction during the demo.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
