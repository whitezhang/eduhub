#!/usr/bin/env node
/**
 * Manual open contest sync (test/prod). Uses EDUHUB_ENV → test.json / prod.json contestSync.
 *
 *   node src/op/contest-sync.mjs
 *   node src/op/contest-sync.mjs --force
 *   EDUHUB_ENV=prod node src/op/contest-sync.mjs
 */
import { getDb } from "../rd/server/db.mjs";
import { runContestSync, contestSyncConfig } from "../rd/server/contest-sync.mjs";
import { policySyncEnv } from "../rd/server/policy-sync.mjs";

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const env = policySyncEnv();
  const cfg = contestSyncConfig();
  console.log(`contest-sync env=${env} enabled=${cfg.enabled} fetchLive=${cfg.fetchLive} dryRun=${dryRun}`);
  const db = getDb();
  const result = await runContestSync(db, { force, dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && !result.skipped) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
