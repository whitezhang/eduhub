import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（eduhub/） */
export const REPO_ROOT = path.resolve(__dirname, "../../..");

/** 服务端数据根：始终在仓库内 `src/rd/server/data` */
export const SERVER_DATA_DIR = path.join(REPO_ROOT, "src/rd/server/data");

export function envName() {
  const e = String(process.env.EDUHUB_ENV || "").toLowerCase();
  if (e === "prod" || e === "test") return e;
  if (process.env.NODE_ENV === "production") return "prod";
  return "test";
}

/** 禁止把 data / 数据库指到项目外的目录 */
export function assertInsideRepo(absPath) {
  const resolved = path.resolve(absPath);
  const rel = path.relative(REPO_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`数据路径必须在项目仓库内: ${absPath}`);
  }
  return resolved;
}

export function resolveDataDir() {
  if (process.env.DATA_DIR) {
    return assertInsideRepo(process.env.DATA_DIR);
  }
  return SERVER_DATA_DIR;
}

export function resolveDbPath(dataDir = resolveDataDir()) {
  if (process.env.EDUHUB_DB) {
    return assertInsideRepo(process.env.EDUHUB_DB);
  }
  const env = envName();
  return path.join(dataDir, "runtime", env, "eduhub.db");
}
