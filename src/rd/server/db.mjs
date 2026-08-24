import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { envName, resolveDataDir, resolveDbPath } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = __dirname;
export const DATA_DIR = resolveDataDir();
const RUNTIME_ENV = envName();
export const RUNTIME_DIR = path.join(DATA_DIR, "runtime", RUNTIME_ENV);
export const CACHE_DIR = path.join(DATA_DIR, "cache", RUNTIME_ENV);
export const SEED_DIR = path.join(DATA_DIR, "seed");
export const CATALOG_DIR = path.join(DATA_DIR, "catalog");
export const PROBLEM_DATA_DIR = path.join(RUNTIME_DIR, "problems");

function renameIfAbsent(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
    return true;
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES")) return false;
    throw err;
  }
}

function replaceEnvDbFromLegacy(legacyDb, envDb) {
  if (!fs.existsSync(legacyDb)) return;
  const need =
    !fs.existsSync(envDb) || fs.statSync(legacyDb).size > fs.statSync(envDb).size;
  if (!need) return;
  fs.mkdirSync(path.dirname(envDb), { recursive: true });
  for (const suffix of ["-wal", "-shm"]) {
    const ep = envDb + suffix;
    const lp = legacyDb + suffix;
    if (fs.existsSync(ep)) fs.unlinkSync(ep);
    if (fs.existsSync(lp)) renameIfAbsent(lp, ep);
  }
  if (fs.existsSync(envDb)) fs.unlinkSync(envDb);
  if (!renameIfAbsent(legacyDb, envDb)) {
    fs.copyFileSync(legacyDb, envDb);
    for (const suffix of ["-wal", "-shm"]) {
      const lp = legacyDb + suffix;
      const ep = envDb + suffix;
      if (fs.existsSync(lp) && !fs.existsSync(ep)) fs.copyFileSync(lp, ep);
    }
  }
}

function migrateLegacyLayout() {
  const legacyRuntime = path.join(DATA_DIR, "runtime");
  const legacyDb = path.join(legacyRuntime, "eduhub.db");
  const envDb = path.join(RUNTIME_DIR, "eduhub.db");
  replaceEnvDbFromLegacy(legacyDb, envDb);
  renameIfAbsent(legacyDb, envDb);
  renameIfAbsent(path.join(legacyRuntime, "eduhub.db-wal"), path.join(RUNTIME_DIR, "eduhub.db-wal"));
  renameIfAbsent(path.join(legacyRuntime, "eduhub.db-shm"), path.join(RUNTIME_DIR, "eduhub.db-shm"));
  renameIfAbsent(path.join(legacyRuntime, "problems"), path.join(RUNTIME_DIR, "problems"));
  renameIfAbsent(path.join(legacyRuntime, "tmp"), path.join(RUNTIME_DIR, "tmp"));
  renameIfAbsent(path.join(DATA_DIR, "eduhub.db"), envDb);
  renameIfAbsent(path.join(DATA_DIR, "eduhub.db-wal"), path.join(RUNTIME_DIR, "eduhub.db-wal"));
  renameIfAbsent(path.join(DATA_DIR, "eduhub.db-shm"), path.join(RUNTIME_DIR, "eduhub.db-shm"));
  renameIfAbsent(path.join(DATA_DIR, "problems"), path.join(RUNTIME_DIR, "problems"));
  renameIfAbsent(path.join(DATA_DIR, "tmp"), path.join(RUNTIME_DIR, "tmp"));
  const legacyCache = path.join(DATA_DIR, "cache");
  renameIfAbsent(path.join(legacyCache, "gesp"), path.join(CACHE_DIR, "gesp"));
  renameIfAbsent(path.join(legacyCache, "crawls"), path.join(CACHE_DIR, "crawls"));
  renameIfAbsent(path.join(legacyCache, "adacpp-profile"), path.join(CACHE_DIR, "adacpp-profile"));
  const oldPdfs = path.join(DATA_DIR, "imports", "gesp");
  const cacheGesp = path.join(CACHE_DIR, "gesp");
  const seedGesp = path.join(SEED_DIR, "gesp");
  if (fs.existsSync(oldPdfs)) {
    fs.mkdirSync(cacheGesp, { recursive: true });
    fs.mkdirSync(seedGesp, { recursive: true });
    for (const name of fs.readdirSync(oldPdfs)) {
      const from = path.join(oldPdfs, name);
      if (name === "parsed" && fs.statSync(from).isDirectory()) {
        for (const json of fs.readdirSync(from)) {
          renameIfAbsent(path.join(from, json), path.join(seedGesp, json));
        }
        continue;
      }
      if (name.endsWith(".pdf")) renameIfAbsent(from, path.join(cacheGesp, name));
    }
  }
  renameIfAbsent(path.join(DATA_DIR, "crawls"), path.join(CACHE_DIR, "crawls"));
}

migrateLegacyLayout();

export const DB_PATH = resolveDbPath(DATA_DIR);

let db;

function ensureDirs() {
  migrateLegacyLayout();
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.mkdirSync(PROBLEM_DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(RUNTIME_DIR, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(SEED_DIR, "gesp"), { recursive: true });
  fs.mkdirSync(path.join(CATALOG_DIR, "problems"), { recursive: true });
}

function schema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_plain TEXT,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','coach')),
      grade TEXT,
      language TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS cms_blocks (
      key TEXT PRIMARY KEY,
      body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS problems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      time_ms INTEGER NOT NULL DEFAULT 1000,
      memory_mb INTEGER NOT NULL DEFAULT 128,
      io_mode TEXT NOT NULL DEFAULT 'stdin',
      languages TEXT NOT NULL DEFAULT '["cpp","python"]',
      type TEXT NOT NULL DEFAULT 'traditional',
      statement TEXT NOT NULL,
      sample_in TEXT,
      sample_out TEXT,
      sample_note TEXT,
      choice_json TEXT,
      full_score INTEGER NOT NULL DEFAULT 100,
      published INTEGER NOT NULL DEFAULT 1,
      review_note TEXT,
      solution_code TEXT
    );
    CREATE TABLE IF NOT EXISTS testcases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      score INTEGER NOT NULL,
      is_sample INTEGER NOT NULL DEFAULT 0,
      input_rel TEXT NOT NULL,
      output_rel TEXT NOT NULL,
      FOREIGN KEY (problem_id) REFERENCES problems(id)
    );
    CREATE TABLE IF NOT EXISTS problem_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      source TEXT,
      blurb TEXT
    );
    CREATE TABLE IF NOT EXISTS problem_list_items (
      list_id INTEGER NOT NULL,
      problem_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (list_id, problem_id)
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      problem_id INTEGER NOT NULL,
      contest_id INTEGER,
      language TEXT NOT NULL,
      mode TEXT NOT NULL,
      code TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      judged_at TEXT
    );
    CREATE TABLE IF NOT EXISTS contests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      rule TEXT NOT NULL CHECK(rule IN ('practice','oi','ioi')),
      duration_min INTEGER NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS contest_problems (
      contest_id INTEGER NOT NULL,
      problem_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (contest_id, problem_id)
    );
    CREATE TABLE IF NOT EXISTS contest_registrations (
      contest_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (contest_id, user_id),
      FOREIGN KEY (contest_id) REFERENCES contests(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS paper_drafts (
      user_id INTEGER NOT NULL,
      contest_id INTEGER NOT NULL,
      problem_id INTEGER NOT NULL,
      language TEXT,
      code TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, contest_id, problem_id)
    );
    CREATE TABLE IF NOT EXISTS paper_cursors (
      user_id INTEGER NOT NULL,
      contest_id INTEGER NOT NULL,
      problem_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, contest_id)
    );
    CREATE TABLE IF NOT EXISTS external_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_label TEXT NOT NULL,
      title TEXT NOT NULL,
      audience TEXT,
      prep TEXT,
      official_url TEXT,
      official_label TEXT,
      problem_list_slug TEXT,
      seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS guest_usage (
      day TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (day, ip_hash)
    );
    CREATE TABLE IF NOT EXISTS policy_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('published','pending','rejected')),
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contest_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      when_label TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      summary TEXT,
      showcase_label TEXT,
      showcase_url TEXT,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('published','pending','rejected')),
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function migrate(database) {
  const cols = database.prepare("PRAGMA table_info(problems)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("review_note")) {
    database.exec("ALTER TABLE problems ADD COLUMN review_note TEXT");
  }
  if (!names.has("solution_code")) {
    database.exec("ALTER TABLE problems ADD COLUMN solution_code TEXT");
  }
  const contestCols = new Set(database.prepare("PRAGMA table_info(contests)").all().map((c) => c.name));
  if (!contestCols.has("is_demo")) {
    database.exec("ALTER TABLE contests ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0");
  }
  const userCols = new Set(database.prepare("PRAGMA table_info(users)").all().map((c) => c.name));
  if (!userCols.has("password_plain")) {
    database.exec("ALTER TABLE users ADD COLUMN password_plain TEXT");
  }
  // Coach passwords must never be exposed in studio; clear any leftover plaintext.
  database.prepare("UPDATE users SET password_plain = NULL WHERE role = 'coach'").run();
  migratePolicyItems(database);
  migrateContestItems(database);
  if (!tableExists(database, "contest_registrations")) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS contest_registrations (
        contest_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (contest_id, user_id),
        FOREIGN KEY (contest_id) REFERENCES contests(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
  }
}

function migrateContestItems(database) {
  if (!tableExists(database, "contest_items")) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS contest_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        when_label TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        summary TEXT,
        showcase_label TEXT,
        showcase_url TEXT,
        source TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('published','pending','rejected')),
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  const n = database.prepare("SELECT COUNT(*) AS c FROM contest_items").get().c;
  if (n > 0) return;

  let feed = [];
  const cmsPath = path.join(SEED_DIR, "cms.json");
  if (fs.existsSync(cmsPath)) {
    const cms = JSON.parse(fs.readFileSync(cmsPath, "utf8"));
    feed = cms.star_s_links?.tier1 || cms.contest_feed || [];
  }
  const ins = database.prepare(
    `INSERT INTO contest_items (url, when_label, title, summary, showcase_label, showcase_url, source, status, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'published', datetime('now'))`,
  );
  for (const item of feed) {
    if (!item?.url) continue;
    const source = sourceFromContestUrl(item.url);
    try {
      ins.run(
        item.url,
        item.when || "",
        item.title || item.url,
        item.summary || "",
        item.showcase_label || null,
        item.showcase_url || null,
        source,
      );
    } catch (err) {
      if (!String(err.message).includes("UNIQUE")) throw err;
    }
  }
}

function sourceFromContestUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("ccf.org.cn")) return "ccf";
    if (h.includes("moe.gov.cn")) return "moe";
    if (h.endsWith(".gov.cn")) return "gov";
    if (h.includes("jyb.cn")) return "jyb";
    return "media";
  } catch {
    return null;
  }
}

function migratePolicyItems(database) {
  if (!tableExists(database, "policy_items")) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS policy_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        date TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        source TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('published','pending','rejected')),
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  const n = database.prepare("SELECT COUNT(*) AS c FROM policy_items").get().c;
  if (n > 0) return;

  let feed = [];
  const row = database.prepare("SELECT body FROM cms_blocks WHERE key = 'policy_feed'").get();
  if (row) {
    try {
      feed = JSON.parse(row.body || "[]");
    } catch {
      feed = [];
    }
  }
  if (!feed.length) {
    const cmsPath = path.join(SEED_DIR, "cms.json");
    if (fs.existsSync(cmsPath)) {
      const cms = JSON.parse(fs.readFileSync(cmsPath, "utf8"));
      feed = cms.policy_feed || cms.star_s_links?.policy || [];
    }
  }
  const ins = database.prepare(
    `INSERT INTO policy_items (url, date, title, summary, source, status, fetched_at)
     VALUES (?, ?, ?, ?, ?, 'published', datetime('now'))`,
  );
  for (const item of feed) {
    if (!item?.url) continue;
    const source = item.url.includes("moe.gov.cn")
      ? "moe"
      : item.url.includes("gov.cn")
        ? "gov"
        : null;
    try {
      ins.run(item.url, item.date || "", item.title || item.url, item.summary || "", source);
    } catch (err) {
      if (!String(err.message).includes("UNIQUE")) throw err;
    }
  }
}


function tableExists(database, name) {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name),
  );
}

function deleteContest(database, contestId) {
  database.prepare("DELETE FROM contest_problems WHERE contest_id = ?").run(contestId);
  database.prepare("DELETE FROM paper_drafts WHERE contest_id = ?").run(contestId);
  database.prepare("DELETE FROM paper_cursors WHERE contest_id = ?").run(contestId);
  database.prepare("DELETE FROM submissions WHERE contest_id = ?").run(contestId);
  if (tableExists(database, "contest_registrations")) {
    database.prepare("DELETE FROM contest_registrations WHERE contest_id = ?").run(contestId);
  }
  database.prepare("DELETE FROM contests WHERE id = ?").run(contestId);
}

function removeHomemadeProblems(database) {
  const rows = database.prepare("SELECT id FROM problems WHERE code LIKE 'EH-%'").all();
  database.exec("BEGIN");
  try {
    for (const p of rows) {
      database.prepare("DELETE FROM testcases WHERE problem_id = ?").run(p.id);
      database.prepare("DELETE FROM submissions WHERE problem_id = ?").run(p.id);
      database.prepare("DELETE FROM paper_drafts WHERE problem_id = ?").run(p.id);
      database.prepare("DELETE FROM paper_cursors WHERE problem_id = ?").run(p.id);
      database.prepare("DELETE FROM contest_problems WHERE problem_id = ?").run(p.id);
      database.prepare("DELETE FROM problem_list_items WHERE problem_id = ?").run(p.id);
      database.prepare("DELETE FROM problems WHERE id = ?").run(p.id);
    }
    const demos = database
      .prepare("SELECT id FROM contests WHERE is_demo = 1 OR title = ?")
      .all("测试试卷");
    for (const c of demos) deleteContest(database, c.id);
    const emptyPractice = database
      .prepare(
        `SELECT c.id FROM contests c
         LEFT JOIN contest_problems cp ON cp.contest_id = c.id
         WHERE c.title = '周末练习'
         GROUP BY c.id
         HAVING COUNT(cp.problem_id) = 0`,
      )
      .all();
    for (const c of emptyPractice) deleteContest(database, c.id);
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  for (const p of rows) {
    fs.rmSync(path.join(PROBLEM_DATA_DIR, String(p.id)), { recursive: true, force: true });
  }
}

function seedIfEmpty(database) {
  const n = database.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (n > 0) return;

  const hash = bcrypt.hashSync("eduhub", 10);
  database
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, language)
       VALUES (@username, @password_hash, @display_name, @role, @language)`,
    )
    .run({
      username: "coach",
      password_hash: hash,
      display_name: "教练",
      role: "coach",
      language: "cpp",
    });

  database
    .prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)")
    .run(
      "benefits",
      `信息学奥林匹克训练程序设计、算法与数学抽象。系统练习后，学生能把自然语言里的约束写成输入输出明确的程序，并在时间与内存限制下验证对错。

对准备 GESP、CSP-J/S、NOIP、NOI 的学生，这是一条可核对的能力阶梯，而不是零散刷题。本站只提供训练与模拟，官方报名与证书以中国计算机学会网站为准。`,
    );
  const cmsPath = path.join(SEED_DIR, "cms.json");
  let syllabus;
  let timeline;
  let syllabusMeta = null;
  if (fs.existsSync(cmsPath)) {
    const cms = JSON.parse(fs.readFileSync(cmsPath, "utf8"));
    syllabus = JSON.stringify(cms.syllabus || []);
    timeline = JSON.stringify(cms.timeline || []);
    const meta = {};
    if (cms.gesp_csp_bridge) meta.gesp_csp_bridge = cms.gesp_csp_bridge;
    if (Object.keys(meta).length) syllabusMeta = JSON.stringify(meta);
    const starTextKeys = ["hero_pitch", "star_s", "star_t", "star_r"];
    for (const k of starTextKeys) {
      if (cms[k]) {
        database.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)").run(k, cms[k]);
      }
    }
    if (Array.isArray(cms.case_studies)) {
      database
        .prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)")
        .run("case_studies", JSON.stringify(cms.case_studies));
    }
    if (cms.star_s_links) {
      database
        .prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)")
        .run("star_s_links", JSON.stringify(cms.star_s_links));
    }
    if (cms.policy_intro) {
      database.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)").run("policy_intro", cms.policy_intro);
    }
    if (cms.contests_intro) {
      database.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)").run("contests_intro", cms.contests_intro);
    }
    if (Array.isArray(cms.policy_feed)) {
      database
        .prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)")
        .run("policy_feed", JSON.stringify(cms.policy_feed));
    }
  } else {
    syllabus = "[]";
    timeline = "[]";
  }
  database.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)").run("syllabus", syllabus);
  database.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)").run("timeline", timeline);
  if (syllabusMeta) {
    database.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)").run("syllabus_meta", syllabusMeta);
  }
  const knowledgePath = path.join(SEED_DIR, "knowledge-topics.json");
  if (fs.existsSync(knowledgePath)) {
    const kn = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
    const map = {};
    for (const t of kn.topics || []) {
      if (t?.id) map[t.id] = t;
    }
    database.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)").run("knowledge_topics", JSON.stringify(map));
  }

  const lists = [
    ["gesp", "GESP 1–8 级", "gesp", "语法与简单算法"],
    ["csp-j", "CSP-J", "csp-j", "入门级"],
    ["csp-s", "CSP-S", "csp-s", "提高级"],
    ["noip", "NOIP", "noip", "联赛"],
    ["noi", "NOI 入门", "noi", "全国赛风格"],
  ];
  const insL = database.prepare(
    "INSERT INTO problem_lists (slug, title, source, blurb) VALUES (?, ?, ?, ?)",
  );
  for (const row of lists) insL.run(...row);

  const ext = database.prepare(
    `INSERT INTO external_events (month_label, title, audience, prep, official_url, official_label, problem_list_slug, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ext.run("3 / 6 / 9 / 12 月", "GESP", "中小学", "按级别准备", "https://gesp.ccf.org.cn/", "前往 GESP 官网", "gesp", 1);
  ext.run("9 月", "CSP-J/S 第一轮（初赛）", "12 周岁以上", "笔试：选择/阅读程序/完善程序（S 含多选）", "https://www.noi.cn/", "前往 NOI 官网", "csp-j", 2);
  ext.run("10–11 月", "CSP-J/S 第二轮（复赛）", "第一轮通过者", "机试 4 道编程题，OI 赛制", "https://www.noi.cn/", "前往 NOI 官网", "csp-j", 3);
  ext.run("11–12 月", "NOIP", "具备省资格者", "提高组水平", "https://www.noi.cn/", "前往 NOI 官网", "noip", 4);
}

function removeDemoStudent(database) {
  const rows = database
    .prepare(
      `SELECT id FROM users
       WHERE role = 'student' AND (username = 'student' OR display_name = '示例学生')`,
    )
    .all();
  if (!rows.length) return;
  database.exec("BEGIN");
  try {
    for (const u of rows) {
      database.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
      database.prepare("DELETE FROM submissions WHERE user_id = ?").run(u.id);
      database.prepare("DELETE FROM paper_drafts WHERE user_id = ?").run(u.id);
      database.prepare("DELETE FROM paper_cursors WHERE user_id = ?").run(u.id);
      if (tableExists(database, "contest_registrations")) {
        database.prepare("DELETE FROM contest_registrations WHERE user_id = ?").run(u.id);
      }
      database.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

export function getDb() {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  schema(db);
  migrate(db);
  seedIfEmpty(db);
  removeHomemadeProblems(db);
  removeDemoStudent(db);
  return db;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    grade: row.grade,
    language: row.language,
  };
}
