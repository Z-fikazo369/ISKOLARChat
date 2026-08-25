import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Environment-backed feature flags are reloaded whenever Vite restarts.
  server: {
    port: 5173,
    open: true,
  },
});
