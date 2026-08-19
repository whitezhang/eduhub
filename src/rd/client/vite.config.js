import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  plugins: [vue()],
  base: "/",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
  build: {
    // 仓根 output/：本机构建后提交；服务器 deploy 直接用，不再 vite build
    outDir: path.resolve(dir, "../../../output"),
    emptyOutDir: true,
  },
});
