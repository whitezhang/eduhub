/**
 * Scrape all AdaCpp GESP exam practice sets (with answers) into seed/gesp-adacpp/.
 * Requires logged-in profile at data/cache/adacpp-profile.
 *
 *   node src/op/scrape-adacpp-gesp.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEED = path.join(ROOT, "src/rd/server/data/seed/gesp-adacpp");
const PROFILE = path.join(ROOT, "src/rd/server/data/cache/adacpp-profile");
const ACTION_QUIZ = "7f263b08c0922e5007716221e412c182eff058668e";
const INDEX = "https://adacpp.com/practice";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function parseOptions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

function extractSetId(html) {
  const m = html.match(/questionSetId\\":\\"([^\\]+)\\"/) || html.match(/"questionSetId":"([^"]+)"/);
  return m ? m[1] : null;
}

function parseSlug(slug) {
  // gesp-cpp-1ji-202606
  const m = slug.match(/^gesp-(cpp|python)-(\d+)ji-(\d{6})$/i);
  if (!m) return null;
  return { lang: m[1].toLowerCase(), level: Number(m[2]), ym: m[3] };
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

async function listSlugs(page) {
  await page.goto(INDEX, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1500);
  const html = await page.content();
  const re = /https:\/\/adacpp\.com\/practice\/(gesp-[a-z0-9-]+)/g;
  const set = new Set();
  let m;
  while ((m = re.exec(html))) set.add(m[1]);
  // also relative
  const re2 = /\/practice\/(gesp-[a-z0-9-]+)/g;
  while ((m = re2.exec(html))) set.add(m[1]);
  return [...set].sort();
}

async function main() {
  fs.mkdirSync(SEED, { recursive: true });
  if (!fs.existsSync(PROFILE)) {
    console.error("Missing", PROFILE, "- log in via scrape-adacpp-cspj-answers first");
    process.exit(1);
  }

  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: true,
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://adacpp.com/practice/gesp-cpp-1ji-202606", { waitUntil: "domcontentloaded" });
  await sleep(800);
  if ((await page.locator("text=登录后即可提交答案").count()) > 0) {
    console.error("Session expired. Re-login in headed Chrome first.");
    await context.close();
    process.exit(1);
  }
  console.log("session ok");

  const slugs = await listSlugs(page);
  console.log("gesp sets", slugs.length);
  const index = [];

  for (const slug of slugs) {
    const meta = parseSlug(slug);
    const url = `https://adacpp.com/practice/${slug}`;
    process.stdout.write(`==> ${slug} `);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(350);
      const html = await page.content();
      const setId = extractSetId(html);
      if (!setId) {
        console.log("no setId");
        continue;
      }
      const text = await fetchQuiz(page, url, setId);
      const payload = parseActionPayload(text);
      const qs = payload?.data?.data?.questions || payload?.data?.questions || [];
      const qset = payload?.data?.data?.questionSet || payload?.data?.questionSet || {};
      if (!qs.length) {
        console.log("empty");
        continue;
      }
      const questions = qs.map((q, i) => {
        const opts = parseOptions(q.options);
        return {
          id: q.id,
          order: q.order ?? i + 1,
          type: q.type || "single_choice",
          content: q.content || "",
          options: opts,
          answer: normalizeAnswer(q.answer),
          explanation: q.explanation || null,
        };
      });
      const answered = questions.filter((q) => q.answer).length;
      const paper = {
        slug,
        url,
        title: qset.title || slug,
        description: qset.description || "",
        source: "gesp",
        origin: "adacpp.com/practice",
        meta,
        questions,
      };
      fs.writeFileSync(path.join(SEED, `${slug}.json`), JSON.stringify(paper, null, 2), "utf8");
      index.push({ slug, title: paper.title, questions: questions.length, answered, meta });
      console.log(`q ${questions.length} ans ${answered}`);
    } catch (e) {
      console.log("FAIL", e.message || e);
    }
    await sleep(250);
  }

  fs.writeFileSync(path.join(SEED, "_index.json"), JSON.stringify(index, null, 2), "utf8");
  console.log(
    "done",
    index.length,
    "papers",
    "answers",
    index.reduce((s, x) => s + x.answered, 0)
  );
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
