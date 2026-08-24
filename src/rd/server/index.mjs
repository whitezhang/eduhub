#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../op/conf/load-config.mjs";
import { getDb } from "./db.mjs";
import { parsePath, sendJson } from "./http-util.mjs";
import { handleApi } from "./api.mjs";
import { startPolicySyncScheduler } from "./policy-sync.mjs";
import { startContestSyncScheduler } from "./contest-sync.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const DIST = path.join(ROOT, "output");
const PORT = Number(process.env.PORT || 8081);
const production = process.env.NODE_ENV === "production";

loadConfig();
const db = getDb();
startPolicySyncScheduler(db);
startContestSyncScheduler(db);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

function tryStatic(req, res, pathname) {
  if (production && process.env.SERVE_STATIC !== "1") return false;
  if (!fs.existsSync(DIST)) return false;
  let rel = pathname === "/" ? "/index.html" : pathname;
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, "index.html");
  }
  if (!fs.existsSync(file)) return false;
  const ext = path.extname(file);
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname, query } = parsePath(req);
    if (pathname.startsWith("/api/")) {
      const hit = await handleApi(req, res, pathname, query);
      if (!hit) sendJson(res, 404, { error: "接口不存在" });
      return;
    }
    if (tryStatic(req, res, pathname)) return;
    if (!production) {
      sendJson(res, 404, { error: "开发时请同时打开前端：npm run dev" });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "服务器错误" });
  }
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。请先结束占用进程，或只开前端：npm run dev:client`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`eduhub-api http://127.0.0.1:${PORT}`);
});
