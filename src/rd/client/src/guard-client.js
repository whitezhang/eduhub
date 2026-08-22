async function solvePow(nonce, difficulty) {
  const prefix = "0".repeat(Math.max(0, difficulty));
  let counter = 0;
  while (true) {
    counter += 1;
    const data = new TextEncoder().encode(`${nonce}:${counter}`);
    const buf = await crypto.subtle.digest("SHA-256", data);
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex.startsWith(prefix)) return counter;
    if (counter > 50_000_000) throw new Error("验证超时");
  }
}

let inflight = null;

export async function ensureClearance() {
  if (inflight) return inflight;
  inflight = (async () => {
    const chRes = await fetch("/api/challenge", { credentials: "same-origin" });
    const ch = await chRes.json().catch(() => ({}));
    if (!chRes.ok) throw new Error(ch.error || "无法获取验证");
    const counter = await solvePow(ch.nonce, ch.difficulty ?? 2);
    const vRes = await fetch("/api/challenge/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ nonce: ch.nonce, counter }),
    });
    const v = await vRes.json().catch(() => ({}));
    if (!vRes.ok) throw new Error(v.error || "验证失败");
  })();
  try {
    await inflight;
  } finally {
    inflight = null;
  }
}
