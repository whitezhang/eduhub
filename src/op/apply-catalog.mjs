#!/usr/bin/env node
/**
 * Apply git-tracked catalog JSON into local SQLite + runtime testcase files.
 * Usage (repo root): node src/op/apply-catalog.mjs
 */
import { getDb } from "../rd/server/db.mjs";
import { applyCatalog, listCatalogFiles } from "../rd/server/catalog.mjs";

const db = getDb();
const files = listCatalogFiles();
if (!files.length) {
  console.log("apply-catalog: no files in data/catalog/problems/");
  process.exit(0);
}
const result = applyCatalog(db);
console.log(`apply-catalog: applied ${result.applied} / ${result.total}`);
if (result.errors.length) {
  for (const e of result.errors) console.error(`  error: ${e}`);
  process.exit(1);
}
