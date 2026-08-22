#!/usr/bin/env node
/**
 * 释放本机 API / Vite 端口后重新 npm run dev。
 * Windows / Linux 都可用。不会动 systemd 上的生产进程（那用 systemctl restart）。
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API_PORT = Number(process.env.PORT || 8081);
const VITE_PORT = Number(process.env.VITE_PORT || 5171);
const selfPid = String(process.pid);

function pidsOnPort(port) {
  const pids = new Set();
  if (process.platform === "win32") {
    let out = "";
    try {
      out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    } catch {
      return [];
    }
    const portRe = new RegExp(`[:\\]]${port}(?!\\d)`);
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line) || !portRe.test(line)) continue;
      const m = line.trim().match(/(\d+)\s*$/);
      if (m && m[1] !== "0" && m[1] !== selfPid) pids.add(m[1]);
    }
    return [...pids];
  }

  try {
    const out = execFileSync("lsof", ["-ti", `TCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    for (const pid of out.trim().split(/\s+/)) {
      if (pid && pid !== selfPid) pids.add(pid);
    }
  } catch {
    try {
      const out = execFileSync("fuser", [`${port}/tcp`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const pid of out.trim().split(/\s+/)) {
        if (pid && pid !== selfPid) pids.add(pid);
      }
    } catch {
      /* empty */
    }
  }
  return [...pids];
}

function killPid(pid) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", pid], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
    return;
  }
  try {
    process.kill(Number(pid), "SIGTERM");
  } catch {
    /* already gone */
  }
}

function freePorts(ports) {
  const seen = new Set();
  for (const port of ports) {
    for (const pid of pidsOnPort(port)) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      console.log(`kill pid ${pid} on :${port}`);
      killPid(pid);
    }
  }
  return seen.size;
}

const killed = freePorts([API_PORT, VITE_PORT]);
if (killed) {
  await sleep(400);
  const leftover = [...pidsOnPort(API_PORT), ...pidsOnPort(VITE_PORT)];
  for (const pid of leftover) {
    console.log(`kill leftover pid ${pid}`);
    killPid(pid);
  }
  await sleep(200);
} else {
  console.log(`ports ${API_PORT}, ${VITE_PORT} were free`);
}

console.log("restart dev");
const child = spawn(process.execPath, [path.join(root, "src/op/dev.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
