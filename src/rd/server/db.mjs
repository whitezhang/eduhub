import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = __dirname;
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
export const RUNTIME_DIR = path.join(DATA_DIR, "runtime");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const SEED_DIR = path.join(DATA_DIR, "seed");
export const CATALOG_DIR = path.join(DATA_DIR, "catalog");
export const PROBLEM_DATA_DIR = path.join(RUNTIME_DIR, "problems");

function renameIfAbsent(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES")) return;
    throw err;
  }
}

function migrateLegacyLayout() {
  renameIfAbsent(path.join(DATA_DIR, "eduhub.db"), path.join(RUNTIME_DIR, "eduhub.db"));
  renameIfAbsent(path.join(DATA_DIR, "eduhub.db-wal"), path.join(RUNTIME_DIR, "eduhub.db-wal"));
  renameIfAbsent(path.join(DATA_DIR, "eduhub.db-shm"), path.join(RUNTIME_DIR, "eduhub.db-shm"));
  renameIfAbsent(path.join(DATA_DIR, "problems"), path.join(RUNTIME_DIR, "problems"));
  renameIfAbsent(path.join(DATA_DIR, "tmp"), path.join(RUNTIME_DIR, "tmp"));
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

function resolvedDbPath() {
  if (process.env.EDUHUB_DB) return process.env.EDUHUB_DB;
  const neu = path.join(RUNTIME_DIR, "eduhub.db");
  const old = path.join(DATA_DIR, "eduhub.db");
  return fs.existsSync(neu) || !fs.existsSync(old) ? neu : old;
}

export const DB_PATH = resolvedDbPath();

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
      review_note TEXT
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
  `);
}

function migrate(database) {
  const cols = database.prepare("PRAGMA table_info(problems)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("review_note")) {
    database.exec("ALTER TABLE problems ADD COLUMN review_note TEXT");
  }
  const contestCols = new Set(database.prepare("PRAGMA table_info(contests)").all().map((c) => c.name));
  if (!contestCols.has("is_demo")) {
    database.exec("ALTER TABLE contests ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0");
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
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, grade, language)
       VALUES (@username, @password_hash, @display_name, @role, @grade, @language)`,
    )
    .run({
      username: "student",
      password_hash: hash,
      display_name: "示例学生",
      role: "student",
      grade: "初二",
      language: "cpp",
    });

  database
    .prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)")
    .run(
      "benefits",
      `信息学奥林匹克训练程序设计、算法与数学抽象。系统练习后，学生能把自然语言里的约束写成输入输出明确的程序，并在时间与内存限制下验证对错。

对准备 GESP、CSP-J/S、NOIP、NOI 的学生，这是一条可核对的能力阶梯，而不是零散刷题。本站只提供训练与模拟，官方报名与证书以中国计算机学会网站为准。`,
    );
  const syllabus = JSON.stringify([
    {
      slug: "gesp",
      title: "GESP 1–8 级",
      blurb: "语法、简单算法与上机习惯。图形化本期不做。",
    },
    {
      slug: "csp-j",
      title: "CSP-J",
      blurb: "入门级：第一轮客观题，第二轮四道编程题。",
    },
    {
      slug: "csp-s",
      title: "CSP-S",
      blurb: "提高级，与 CSP-J 互相独立。",
    },
    {
      slug: "noip",
      title: "NOIP",
      blurb: "提高组水平，通常一天四题。",
    },
    {
      slug: "noi",
      title: "NOI 入门",
      blurb: "全国决赛风格的题型与部分分。",
    },
  ]);
  database.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)").run("syllabus", syllabus);
  const timeline = JSON.stringify([
    { month_label: "3 / 6 / 9 / 12 月", title: "GESP 认证", prep: "按级别刷对应题单，考前两周做混合卷。" },
    { month_label: "9 月", title: "CSP-J/S 第一轮", prep: "客观题：计基、语法、阅读程序。" },
    { month_label: "10–11 月", title: "CSP-J/S 第二轮", prep: "四道编程题；用 OI 赛制模拟。" },
    { month_label: "11–12 月", title: "NOIP", prep: "CSP-S 第二轮后按省资格准备。" },
    { month_label: "次年 7 月前后", title: "NOI", prep: "省选之后。本站仅提供风格相近的训练题。" },
  ]);
  database.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?)").run("timeline", timeline);

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
  ext.run("9 月", "CSP-J/S 第一轮", "12 周岁以上", "客观题", "https://www.noi.cn/", "前往 NOI 官网", "csp-j", 2);
  ext.run("10–11 月", "CSP-J/S 第二轮", "第一轮通过者", "四道编程题，OI 赛制", "https://www.noi.cn/", "前往 NOI 官网", "csp-j", 3);
  ext.run("11–12 月", "NOIP", "具备省资格者", "提高组水平", "https://www.noi.cn/", "前往 NOI 官网", "noip", 4);
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
