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

export function register(username, password, displayName) {
  const db = getDb();
  const name = String(username || "").trim();
  const pass = String(password || "");
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) {
    return { error: "用户名为 3–20 位字母数字或下划线" };
  }
  if (pass.length < 4) return { error: "密码至少 4 位" };
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
  if (exists) return { error: "用户名已存在" };
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, language)
     VALUES (?, ?, ?, 'student', 'cpp')`,
  ).run(name, bcrypt.hashSync(pass, 10), String(displayName || name).slice(0, 40));
  return login(name, pass);
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
