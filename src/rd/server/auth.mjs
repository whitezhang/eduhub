import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb, publicUser } from "./db.mjs";
import { parseCookies } from "./http-util.mjs";

const COOKIE = "eduhub_sso";
const TTL_SEC = 60 * 60 * 24 * 30;

function secret() {
  return process.env.SSO_SECRET || "eduhub-dev-change-me";
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function cookieHeader(sid, req) {
  const secure =
    process.env.SSO_SECURE === "1" ||
    req?.headers?.["x-forwarded-proto"] === "https";
  const parts = [
    `${COOKIE}=${encodeURIComponent(sid)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${TTL_SEC}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function login(username, password) {
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username || "").trim());
  if (!user || !bcrypt.compareSync(String(password || ""), user.password_hash)) {
    return null;
  }
  const sid = b64url(crypto.randomBytes(24));
  const expires = Math.floor(Date.now() / 1000) + TTL_SEC;
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  db.prepare("INSERT INTO sessions (sid, user_id, expires_at) VALUES (?, ?, ?)").run(sid, user.id, expires);
  return { sid, user: publicUser(user) };
}

function randomChars(len, alphabet = "abcdefghijkmnpqrstuvwxyz23456789") {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Coach-only: create a student with random username + password. Returns plaintext password once. */
export function createStudent() {
  const db = getDb();
  let name = "";
  for (let i = 0; i < 8; i++) {
    name = `s${randomChars(7)}`;
    if (!db.prepare("SELECT id FROM users WHERE username = ?").get(name)) break;
    name = "";
  }
  if (!name) return { error: "无法生成唯一用户名，请重试" };
  const pass = randomChars(8);
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, password_plain, display_name, role, language)
       VALUES (?, ?, ?, ?, 'student', 'cpp')`,
    )
    .run(name, bcrypt.hashSync(pass, 10), pass, name);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  return { user: publicUser(row), password: pass };
}

/** Logged-in user updates own display name. */
export function updateDisplayName(userId, displayName) {
  const name = String(displayName || "").trim().slice(0, 40);
  if (!name) return { error: "显示名不能为空" };
  if (name.length < 1 || name.length > 40) return { error: "显示名最多 40 字" };
  const db = getDb();
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(name, userId);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  return { user: publicUser(row) };
}

/** Coach-only: delete a student and related data. Cannot delete coaches. */
export function deleteStudent(userId) {
  const db = getDb();
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return { error: "无效用户" };
  const row = db.prepare("SELECT id, role, username FROM users WHERE id = ?").get(id);
  if (!row) return { error: "用户不存在" };
  if (row.role !== "student") return { error: "只能删除学生账号" };
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  const has = (n) => tables.includes(n);
  db.exec("BEGIN");
  try {
    if (has("sessions")) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    if (has("submissions")) db.prepare("DELETE FROM submissions WHERE user_id = ?").run(id);
    if (has("paper_drafts")) db.prepare("DELETE FROM paper_drafts WHERE user_id = ?").run(id);
    if (has("paper_cursors")) db.prepare("DELETE FROM paper_cursors WHERE user_id = ?").run(id);
    if (has("contest_registrations")) db.prepare("DELETE FROM contest_registrations WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { ok: true, username: row.username };
}

export function userFromRequest(req) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid) return null;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.sid = ? AND s.expires_at > ?`,
    )
    .get(sid, now);
  return publicUser(row);
}

export function logout(req) {
  const sid = parseCookies(req)[COOKIE];
  if (sid) getDb().prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
}

export function requireUser(req, res) {
  const u = userFromRequest(req);
  if (!u) {
    return null;
  }
  return u;
}

export function requireCoach(req) {
  const u = userFromRequest(req);
  if (!u || u.role !== "coach") return null;
  return u;
}

void fromB64url;
void secret;
