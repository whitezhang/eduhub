import { ensureClearance } from "./guard-client.js";

let sessionStore = null;

export function bindSessionStore(store) {
  sessionStore = store;
}

async function request(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function api(path, opts = {}) {
  const skipGuard = opts.skipGuard === true;
  const doCall = () => request(path, opts);

  let { res, data } = await doCall();

  if (!skipGuard && data.code === "NEED_CHALLENGE") {
    await ensureClearance();
    ({ res, data } = await doCall());
  }

  if (!res.ok) {
    if (data.code === "LOGIN_REQUIRED" && sessionStore) {
      sessionStore.openLogin();
    }
    const err = new Error(data.error || "请求失败");
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}
