import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: { exclude: ["node_modules/**", "dist/**", "src-tauri/**", "backups/**"] }
});
