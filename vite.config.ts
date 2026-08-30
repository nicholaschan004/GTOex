/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    // The range parser and, later, the equity engine are pure functions with
    // no DOM. Keeping the default environment on node means the test suite
    // stays fast enough to run on every save.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
