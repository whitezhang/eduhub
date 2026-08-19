#!/usr/bin/env node
/**
 * Upsert homepage CMS blocks (syllabus / timeline) from seed/cms.json.
 * Runs on deploy so redeploy refreshes the live SQLite cms_blocks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../rd/server/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEED = path.join(ROOT, "src/rd/server/data/seed/cms.json");

function main() {
  if (!fs.existsSync(SEED)) {
    console.error("missing", SEED);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(SEED, "utf8"));
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO cms_blocks (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body",
  );
  if (Array.isArray(data.syllabus)) {
    upsert.run("syllabus", JSON.stringify(data.syllabus));
    console.log("cms syllabus", data.syllabus.length, "items");
  }
  if (Array.isArray(data.timeline)) {
    upsert.run("timeline", JSON.stringify(data.timeline));
    console.log("cms timeline", data.timeline.length, "items");
  }
  const meta = {};
  if (Array.isArray(data.csp_compare)) meta.csp_compare = data.csp_compare;
  if (data.gesp_csp_bridge) meta.gesp_csp_bridge = data.gesp_csp_bridge;
  if (Object.keys(meta).length) {
    upsert.run("syllabus_meta", JSON.stringify(meta));
    if (meta.csp_compare) console.log("cms csp_compare", meta.csp_compare.length, "rows");
    if (meta.gesp_csp_bridge) console.log("cms gesp_csp_bridge");
  }
  console.log("done");
}

main();
