import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
  },
  test: {
    // Kopiert shared/ nach desktop/shared, siehe test/helpers/copyShared.js.
    globalSetup: ["./test/helpers/copyShared.js"],
  },
});
