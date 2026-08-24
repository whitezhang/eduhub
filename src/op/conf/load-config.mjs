import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envName } from "../../rd/server/paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object" && base[k]) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

let cached;

export function loadConfig() {
  if (cached) return cached;
  const name = envName();
  const file = path.join(__dirname, `${name}.json`);
  const local = path.join(__dirname, `${name}.local.json`);
  let conf = JSON.parse(fs.readFileSync(file, "utf8"));
  if (fs.existsSync(local)) {
    conf = deepMerge(conf, JSON.parse(fs.readFileSync(local, "utf8")));
  }
  if (process.env.SSO_SECRET) {
    conf.secrets = { ...conf.secrets, ssoSecret: process.env.SSO_SECRET };
  }
  cached = conf;
  return conf;
}

export function getConfig() {
  return loadConfig();
}
