/**
 * With an existing AdaCpp login in cache/adacpp-profile, pull quiz answers
 * via getQuizAction and merge into seed/csp-j/*.json
 *
 *   node src/op/scrape-adacpp-cspj-answers.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEED = path.join(ROOT, "src/rd/server/data/seed/csp-j");
const OUT = path.join(SEED, "_answers.json");
const PROFILE = path.join(ROOT, "src/rd/server/data/cache/adacpp-profile");
const ACTION_QUIZ = "7f263b08c0922e5007716221e412c182eff058668e";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadPapers() {
  return fs
    .readdirSync(SEED)
    .filter((f) => f.startsWith("cspj-") && f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(SEED, f), "utf8")));
}

function parseActionPayload(text) {
  for (const line of text.split("\n")) {
    if (!line.startsWith("1:")) continue;
    try {
      return JSON.parse(line.slice(2));
    } catch {
      /* continue */
    }
  }
  // fallback: any success blob
  const m = text.match(/1:(\{.*"success".*\})/);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeAnswer(raw) {
  if (raw == null) return null;
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return String(raw).replace(/[\[\]"]/g, "").trim();
    }
  }
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return String(v).trim();
}

async function fetchQuiz(page, url, questionSetId) {
  return page.evaluate(
    async ({ actionId, url, questionSetId }) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          Accept: "text/x-component",
          "Next-Action": actionId,
        },
        body: JSON.stringify([{ questionSetId, locale: "zh" }]),
      });
      return await res.text();
    },
    { actionId: ACTION_QUIZ, url, questionSetId }
  );
}

function extractSetId(html) {
  const m = html.match(/questionSetId\\":\\"([^\\]+)\\"/) || html.match(/"questionSetId":"([^"]+)"/);
  return m ? m[1] : null;
}

async function main() {
  const papers = loadPapers();
  if (!papers.length) {
    console.error("No seed. Run python src/op/cspj_adacpp_import.py --no-import first");
    process.exit(1);
  }
  if (!fs.existsSync(PROFILE)) {
    console.error("Missing login profile. Run once headed and log in.");
    process.exit(1);
  }

  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: true,
  });
  const page = context.pages()[0] || (await context.newPage());

  // verify session
  await page.goto("https://adacpp.com/practice/cspj-stack", { waitUntil: "domcontentloaded" });
  await sleep(800);
  if ((await page.locator("text=登录后即可提交答案").count()) > 0) {
    console.error("Session expired. Re-run headed login.");
    await context.close();
    process.exit(1);
  }
  console.log("session ok");

  const byId = {};
  for (const paper of papers) {
    const url = paper.url || `https://adacpp.com/practice/${paper.slug}`;
    process.stdout.write(`==> ${paper.slug} `);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(400);
      const html = await page.content();
      const setId = extractSetId(html);
      if (!setId) {
        console.log("no setId");
        continue;
      }
      const text = await fetchQuiz(page, url, setId);
      const payload = parseActionPayload(text);
      const questions = payload?.data?.data?.questions || payload?.data?.questions || [];
      if (!questions.length) {
        console.log("empty", text.slice(0, 120).replace(/\n/g, " "));
        continue;
      }
      let n = 0;
      const ansMap = new Map(questions.map((q) => [q.id, q]));
      for (const q of paper.questions || []) {
        const hit = ansMap.get(q.id);
        if (!hit) continue;
        const ans = normalizeAnswer(hit.answer);
        if (ans) {
          q.answer = ans;
          q.explanation = hit.explanation || null;
          byId[q.id] = { answer: ans, explanation: q.explanation };
          n++;
        }
      }
      fs.writeFileSync(path.join(SEED, `${paper.slug}.json`), JSON.stringify(paper, null, 2), "utf8");
      console.log(`answers ${n}/${paper.questions.length}`);
    } catch (e) {
      console.log("FAIL", e.message || e);
    }
    await sleep(300);
  }

  fs.writeFileSync(OUT, JSON.stringify({ byId }, null, 2), "utf8");
  console.log("wrote", OUT, "total", Object.keys(byId).length);
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
