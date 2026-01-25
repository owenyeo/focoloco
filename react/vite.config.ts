import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html")
      },
      output: {
        entryFileNames: () => {
          // Keep predictable names for background/content if we add them as entries later
          return "assets/[name]-[hash].js";
        }
      }
    }
  }
});
