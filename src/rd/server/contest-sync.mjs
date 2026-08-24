/**
 * Server-side open contest / tier1 activity sync → contest_items.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig, loadConfig } from "../../op/conf/load-config.mjs";
import { SEED_DIR } from "./db.mjs";
import { policySyncEnv } from "./policy-sync.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KEYWORDS = [
  "编程",
  "信息学",
  "GESP",
  "CSP",
  "NOI",
  "创客",
  "黑客松",
  "人工智能",
  "机器人",
  "科技创新",
  "等级认证",
];

const MOE_SEARCH_KEYWORDS = [
  "青少年编程",
  "信息学奥林匹克",
  "创客",
  "人工智能大赛",
  "GESP",
];

const LIST_PAGES = [
  { source: "gesp", url: "https://gesp.ccf.org.cn/", relaxed: true },
  { source: "ccf", url: "https://www.ccf.org.cn/", relaxed: true },
];

const DEFAULT_SYNC = {
  enabled: true,
  scheduler: false,
  fetchLive: true,
  newStatus: "pending",
  scheduleHour: 6,
  scheduleMinute: 0,
  tzOffsetMin: 480,
  fetchTimeoutMs: 20000,
  requestDelayMs: 400,
  userAgent:
    "EduHubContestSync/1.0 (+https://github.com/eduhub; education contest aggregator)",
};

export function contestSyncConfig() {
  loadConfig();
  const conf = getConfig();
  return { ...DEFAULT_SYNC, ...(conf.contestSync || {}) };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function hostAllowed(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (h.includes("moe.gov.cn")) return true;
  if (h.endsWith(".gov.cn") || h === "gov.cn") return true;
  if (h.includes("ccf.org.cn")) return true;
  if (h === "jyb.cn" || h.endsWith(".jyb.cn")) return true;
  if (h.includes("thepaper.cn") || h.includes("qq.com") || h.includes("hangzhou.com.cn")) return true;
  if (h.includes("shqsnkj.com")) return true;
  return false;
}

function titleMatches(text) {
  const t = String(text || "");
  return KEYWORDS.some((k) => t.includes(k));
}

function isArticleUrl(url) {
  return /t20\d{6}|\/post_|content\/post_|newsDetail_forward_/i.test(url);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max = 160) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function extractLinks(html, baseUrl, options = {}) {
  const relaxed = Boolean(options.relaxed);
  const out = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = normalizeUrl(m[1], baseUrl);
    if (!url) continue;
    const host = new URL(url).hostname;
    if (!hostAllowed(host)) continue;
    const title = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (!title || title.length < 6) continue;
    if (relaxed) {
      if (!isArticleUrl(url) && !titleMatches(title)) continue;
    } else if (!titleMatches(title)) {
      continue;
    }
    out.push({ url, title });
  }
  return out;
}

async function fetchText(url, cfg) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.fetchTimeoutMs || 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": cfg.userAgent || DEFAULT_SYNC.userAgent,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSummary(url, cfg) {
  try {
    const html = await fetchText(url, cfg);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = stripHtml(titleMatch?.[1] || "");
    const body = stripHtml(html);
    const snippet = body.length > pageTitle.length + 20 ? body.slice(pageTitle.length).trim() : body;
    return truncate(snippet, 160);
  } catch {
    return "";
  }
}

function readSeedFeed() {
  const cmsPath = path.join(SEED_DIR, "cms.json");
  if (!fs.existsSync(cmsPath)) return [];
  try {
    const cms = JSON.parse(fs.readFileSync(cmsPath, "utf8"));
    return cms.star_s_links?.tier1 || cms.contest_feed || [];
  } catch {
    return [];
  }
}

function upsertMeta(db, patch) {
  const row = db.prepare("SELECT body FROM cms_blocks WHERE key = 'contest_sync_meta'").get();
  let meta = {};
  if (row) {
    try {
      meta = JSON.parse(row.body || "{}");
    } catch {
      meta = {};
    }
  }
  const next = { ...meta, ...patch };
  db.prepare(
    "INSERT INTO cms_blocks (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body",
  ).run("contest_sync_meta", JSON.stringify(next));
  return next;
}

function sourceFromUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("gesp.ccf.org.cn") || h.includes("ccf.org.cn")) return "ccf";
    if (h.includes("moe.gov.cn")) return "moe";
    if (h.endsWith(".gov.cn")) return "gov";
    if (h.includes("jyb.cn")) return "jyb";
    return "media";
  } catch {
    return null;
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ force?: boolean, dryRun?: boolean }} options
 */
export async function runContestSync(db, options = {}) {
  const cfg = contestSyncConfig();
  const env = policySyncEnv();
  if (!cfg.enabled && !options.force) {
    return { ok: false, skipped: true, reason: "contestSync.disabled", env };
  }

  const dryRun = options.dryRun ?? !cfg.fetchLive;
  const newStatus = cfg.newStatus === "published" ? "published" : "pending";
  const discovered = new Map();

  if (!dryRun) {
    for (const kw of MOE_SEARCH_KEYWORDS) {
      const searchUrl = `http://www.moe.gov.cn/was5/web/search?channelid=239993&searchword=${encodeURIComponent(kw)}`;
      try {
        const html = await fetchText(searchUrl, cfg);
        const links = extractLinks(html, searchUrl, { relaxed: true });
        for (const link of links) {
          if (!discovered.has(link.url)) {
            discovered.set(link.url, { ...link, source: "moe" });
          }
        }
        await sleep(cfg.requestDelayMs || 400);
      } catch (err) {
        console.warn("[contest-sync] moe search failed", kw, err.message);
      }
    }
    for (const page of LIST_PAGES) {
      try {
        const html = await fetchText(page.url, cfg);
        const links = extractLinks(html, page.url, { relaxed: true });
        for (const link of links) {
          if (!discovered.has(link.url)) {
            discovered.set(link.url, { ...link, source: page.source });
          }
        }
        await sleep(cfg.requestDelayMs || 400);
      } catch (err) {
        console.warn("[contest-sync] list page failed", page.url, err.message);
      }
    }
  }

  const existingUrls = new Set(
    db.prepare("SELECT url FROM contest_items").all().map((r) => r.url),
  );
  const insert = db.prepare(
    `INSERT INTO contest_items (url, when_label, title, summary, showcase_label, showcase_url, source, status, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  const updateFetched = db.prepare(
    "UPDATE contest_items SET fetched_at = datetime('now') WHERE url = ?",
  );

  let added = 0;
  let scanned = 0;

  if (!dryRun) {
    for (const [url, item] of discovered) {
      scanned += 1;
      if (existingUrls.has(url)) {
        updateFetched.run(url);
        continue;
      }
      let summary = "";
      if (newStatus === "pending") {
        summary = await fetchSummary(url, cfg);
        await sleep(cfg.requestDelayMs || 400);
      }
      insert.run(
        url,
        "",
        item.title,
        summary,
        null,
        null,
        item.source || sourceFromUrl(url),
        newStatus,
      );
      existingUrls.add(url);
      added += 1;
    }
  }

  const seedFeed = readSeedFeed();
  for (const item of seedFeed) {
    if (!item?.url) continue;
    scanned += 1;
    if (existingUrls.has(item.url)) {
      updateFetched.run(item.url);
      continue;
    }
    if (dryRun) continue;
    try {
      insert.run(
        item.url,
        item.when || "",
        item.title || item.url,
        item.summary || "",
        item.showcase_label || null,
        item.showcase_url || null,
        sourceFromUrl(item.url),
        "published",
      );
      existingUrls.add(item.url);
      added += 1;
    } catch (err) {
      if (!String(err.message).includes("UNIQUE")) throw err;
    }
  }

  const syncedAt = new Date().toISOString();
  const meta = dryRun
    ? upsertMeta(db, { last_dry_run_at: syncedAt, env })
    : upsertMeta(db, {
        synced_at: syncedAt,
        last_error: null,
        env,
        last_added: added,
        last_scanned: scanned,
      });

  if (!dryRun) {
    db.prepare(
      "INSERT INTO cms_blocks (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body",
    ).run("contest_synced_at", syncedAt);
  }

  return {
    ok: true,
    env,
    dryRun,
    added,
    scanned,
    discovered: discovered.size,
    synced_at: meta.synced_at || syncedAt,
  };
}

export function msUntilNextContestSync(cfg = contestSyncConfig()) {
  const hour = Number(cfg.scheduleHour ?? 6);
  const minute = Number(cfg.scheduleMinute ?? 0);
  const offsetMin = Number(cfg.tzOffsetMin ?? 480);
  const now = Date.now();
  const utcMs = now + offsetMin * 60 * 1000;
  const d = new Date(utcMs);
  const target = new Date(d);
  target.setUTCHours(hour, minute, 0, 0);
  let targetMs = target.getTime() - offsetMin * 60 * 1000;
  if (targetMs <= now) targetMs += 24 * 60 * 60 * 1000;
  return targetMs - now;
}

export function startContestSyncScheduler(db) {
  const cfg = contestSyncConfig();
  const env = policySyncEnv();
  if (!cfg.enabled || !cfg.scheduler) {
    console.log(`[contest-sync] scheduler off (env=${env})`);
    return;
  }
  const run = async () => {
    try {
      const result = await runContestSync(db);
      console.log("[contest-sync] scheduled run", result);
    } catch (err) {
      console.error("[contest-sync] scheduled run failed", err);
      upsertMeta(db, { last_error: String(err.message || err), env: policySyncEnv() });
    }
  };
  const delay = msUntilNextContestSync(cfg);
  console.log(
    `[contest-sync] scheduler on (env=${env}); first run in ${Math.round(delay / 1000)}s`,
  );
  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, delay);
}
