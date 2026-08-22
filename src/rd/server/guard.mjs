import crypto from "node:crypto";
import { getConfig } from "../../op/conf/load-config.mjs";
import { parseCookies, sendJson } from "./http-util.mjs";

const CLEARANCE_COOKIE = "eduhub_clearance";

const pendingChallenges = new Map();
const rateWindows = new Map();

function guardConf() {
  return getConfig().guard || {};
}

function signingSecret() {
  return getConfig().secrets?.ssoSecret || "eduhub-dev-change-me";
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function hmac(data) {
  return b64url(crypto.createHmac("sha256", signingSecret()).update(data).digest());
}

function verifyHmac(data, sig) {
  const want = hmac(data);
  if (!sig || sig.length !== want.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  } catch {
    return false;
  }
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress || "0.0.0.0";
}

function cookieSecure(req) {
  return process.env.SSO_SECURE === "1" || req?.headers?.["x-forwarded-proto"] === "https";
}

function setCookie(name, value, req, maxAgeSec) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (cookieSecure(req)) parts.push("Secure");
  return parts.join("; ");
}

function pruneChallenges() {
  const now = Date.now();
  for (const [k, v] of pendingChallenges) {
    if (v.expires < now) pendingChallenges.delete(k);
  }
}

function pruneRateWindows() {
  const now = Date.now();
  for (const [k, v] of rateWindows) {
    if (v.resetAt <= now) rateWindows.delete(k);
  }
}

function checkRateLimit(req, bucket, limitPerMin) {
  pruneRateWindows();
  const ip = clientIp(req);
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  let win = rateWindows.get(key);
  if (!win || win.resetAt <= now) {
    win = { count: 0, resetAt: now + 60_000 };
    rateWindows.set(key, win);
  }
  win.count += 1;
  if (win.count > limitPerMin) {
    const retry = Math.max(1, Math.ceil((win.resetAt - now) / 1000));
    return retry;
  }
  return 0;
}

function sendRateLimited(res, retrySec) {
  sendJson(res, 429, { error: "请求过于频繁，请稍后再试", code: "RATE_LIMIT" }, { "Retry-After": String(retrySec) });
}

function sendNeedChallenge(res) {
  sendJson(res, 403, { error: "需要完成浏览器验证", code: "NEED_CHALLENGE" });
}

export function hasClearance(req) {
  const raw = parseCookies(req)[CLEARANCE_COOKIE];
  if (!raw) return false;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!verifyHmac(payload, sig)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

function hashSolution(nonce, counter) {
  return crypto.createHash("sha256").update(`${nonce}:${counter}`).digest("hex");
}

function solutionValid(nonce, counter, difficulty) {
  const hex = hashSolution(nonce, counter);
  const prefix = "0".repeat(Math.max(0, difficulty));
  return hex.startsWith(prefix);
}

export function issueChallenge() {
  pruneChallenges();
  const conf = guardConf();
  const difficulty = conf.challengeDifficulty ?? 2;
  const ttl = (conf.challengeTtlSec ?? 300) * 1000;
  const nonce = b64url(crypto.randomBytes(16));
  const expires = Date.now() + ttl;
  pendingChallenges.set(nonce, { difficulty, expires });
  return { nonce, difficulty, expires: Math.floor(expires / 1000) };
}

export function verifyChallengeBody(req, body) {
  pruneChallenges();
  const nonce = String(body?.nonce || "");
  const counter = Number(body?.counter);
  const pending = pendingChallenges.get(nonce);
  if (!pending || pending.expires < Date.now()) {
    return { error: "挑战已过期，请刷新重试" };
  }
  if (!Number.isFinite(counter) || counter < 0 || counter > 50_000_000) {
    return { error: "无效解答" };
  }
  if (!solutionValid(nonce, counter, pending.difficulty)) {
    return { error: "验证未通过" };
  }
  pendingChallenges.delete(nonce);
  const conf = guardConf();
  const ttl = conf.clearanceTtlSec ?? 7200;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = String(exp);
  const cookie = setCookie(CLEARANCE_COOKIE, `${payload}.${hmac(payload)}`, req, ttl);
  return { cookie };
}

export async function handleChallengeRoutes(req, res, method, pathname) {
  const conf = guardConf();
  const rl = conf.rateLimit || {};

  if (method === "GET" && pathname === "/api/challenge") {
    const retry = checkRateLimit(req, "challenge", rl.challengeVerifyPerMin ?? 20);
    if (retry) {
      sendRateLimited(res, retry);
      return true;
    }
    sendJson(res, 200, issueChallenge());
    return true;
  }

  if (method === "POST" && pathname === "/api/challenge/verify") {
    const retry = checkRateLimit(req, "challenge_verify", rl.challengeVerifyPerMin ?? 20);
    if (retry) {
      sendRateLimited(res, retry);
      return true;
    }
    const { readJsonBody } = await import("./http-util.mjs");
    let body;
    try {
      body = await readJsonBody(req, 4096);
    } catch {
      sendJson(res, 400, { error: "请求体无效" });
      return true;
    }
    const got = verifyChallengeBody(req, body);
    if (got.error) {
      sendJson(res, 400, { error: got.error });
      return true;
    }
    sendJson(res, 200, { ok: true }, { "Set-Cookie": got.cookie });
    return true;
  }

  return false;
}

/** List endpoints: rate limit only. Returns false if response already sent. */
export function guardListAccess(req, res, me) {
  if (me?.role === "coach") return true;
  const conf = guardConf();
  const retry = checkRateLimit(req, "list", conf.rateLimit?.listPerMin ?? 60);
  if (retry) {
    sendRateLimited(res, retry);
    return false;
  }
  return true;
}

/** Content endpoints: clearance for anonymous. Returns false if response sent. */
export function guardContentAccess(req, res, me) {
  const conf = guardConf();
  const rl = conf.rateLimit || {};
  if (me?.role === "coach") return true;

  const retry = checkRateLimit(req, "content", rl.contentPerMin ?? 20);
  if (retry) {
    sendRateLimited(res, retry);
    return false;
  }

  if (me) return true;

  if (!hasClearance(req)) {
    sendNeedChallenge(res);
    return false;
  }

  return true;
}

/** Login POST: rate limit. Register would use clearance — not used currently. */
export function guardAuthAccess(req, res) {
  const conf = guardConf();
  const retry = checkRateLimit(req, "auth", conf.rateLimit?.authPerMin ?? 10);
  if (retry) {
    sendRateLimited(res, retry);
    return false;
  }
  return true;
}

/** Returns false if 401 already sent. */
export function guardRequireLogin(req, res, me) {
  if (me) return true;
  sendJson(res, 401, { error: "请先登录", code: "LOGIN_REQUIRED" });
  return false;
}

/** Login + rate limit for protected sections. */
export function guardProtectedAccess(req, res, me) {
  if (!guardRequireLogin(req, res, me)) return false;
  return guardListAccess(req, res, me);
}
