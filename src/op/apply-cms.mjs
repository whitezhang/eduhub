#!/usr/bin/env node
/**
 * Upsert homepage CMS blocks from seed/cms.json.
 * Runs on deploy so redeploy refreshes the live SQLite cms_blocks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../rd/server/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEED = path.join(ROOT, "src/rd/server/data/seed/cms.json");
const KNOWLEDGE = path.join(ROOT, "src/rd/server/data/seed/knowledge-topics.json");

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
  const starTextKeys = ["hero_pitch", "star_s", "star_t", "star_r"];
  for (const k of starTextKeys) {
    if (data[k]) {
      upsert.run(k, data[k]);
      console.log("cms", k);
    }
  }
  if (Array.isArray(data.case_studies)) {
    upsert.run("case_studies", JSON.stringify(data.case_studies));
    console.log("cms case_studies", data.case_studies.length, "items");
  }
  if (data.star_s_links) {
    upsert.run("star_s_links", JSON.stringify(data.star_s_links));
    console.log("cms star_s_links");
  }
  if (data.policy_intro) {
    upsert.run("policy_intro", data.policy_intro);
    console.log("cms policy_intro");
  }
  if (data.contests_intro) {
    upsert.run("contests_intro", data.contests_intro);
    console.log("cms contests_intro");
  }
  if (Array.isArray(data.policy_feed)) {
    upsert.run("policy_feed", JSON.stringify(data.policy_feed));
    console.log("cms policy_feed", data.policy_feed.length, "items");
  }
  if (Array.isArray(data.syllabus)) {
    upsert.run("syllabus", JSON.stringify(data.syllabus));
    console.log("cms syllabus", data.syllabus.length, "items");
  }
  if (Array.isArray(data.timeline)) {
    upsert.run("timeline", JSON.stringify(data.timeline));
    console.log("cms timeline", data.timeline.length, "items");
  }
  const meta = {};
  if (data.gesp_csp_bridge) meta.gesp_csp_bridge = data.gesp_csp_bridge;
  if (Object.keys(meta).length) {
    upsert.run("syllabus_meta", JSON.stringify(meta));
    if (meta.gesp_csp_bridge) console.log("cms gesp_csp_bridge");
  }
  if (fs.existsSync(KNOWLEDGE)) {
    const kn = JSON.parse(fs.readFileSync(KNOWLEDGE, "utf8"));
    const topics = Array.isArray(kn.topics) ? kn.topics : [];
    const map = {};
    for (const t of topics) {
      if (t?.id) map[t.id] = t;
    }
    upsert.run("knowledge_topics", JSON.stringify(map));
    console.log("cms knowledge_topics", topics.length);
  }
  console.log("done");
}

main();
