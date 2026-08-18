import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const children = [];

function run(cmd, args) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
  return child;
}

const server = run(process.execPath, ["src/rd/server/index.mjs"]);
const client = run(process.execPath, [
  path.join(root, "node_modules/vite/bin/vite.js"),
  "--config",
  "src/rd/client/vite.config.js",
]);

function stop() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

server.on("exit", (code) => {
  if (code) {
    stop();
    process.exit(code);
  }
});
client.on("exit", (code) => {
  if (code) {
    stop();
    process.exit(code);
  }
});
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
