#!/usr/bin/env node
/**
 * Manual policy sync (test/prod). Uses EDUHUB_ENV → test.json / prod.json policySync.
 *
 *   node src/op/policy-sync.mjs
 *   node src/op/policy-sync.mjs --force
 *   EDUHUB_ENV=prod node src/op/policy-sync.mjs
 */
import { getDb } from "../rd/server/db.mjs";
import { runPolicySync, policySyncEnv, policySyncConfig } from "../rd/server/policy-sync.mjs";

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const env = policySyncEnv();
  const cfg = policySyncConfig();
  console.log(`policy-sync env=${env} enabled=${cfg.enabled} fetchLive=${cfg.fetchLive} dryRun=${dryRun}`);
  const db = getDb();
  const result = await runPolicySync(db, { force, dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && !result.skipped) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
