import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getDb, PROBLEM_DATA_DIR, RUNTIME_DIR } from "./db.mjs";

const queue = [];
let running = false;

export function queueStatus() {
  return { waiting: queue.length, running: running ? 1 : 0 };
}

export function enqueue(submissionId) {
  if (queue.length >= 30) {
    return { error: "评测队列已满，请稍后提交" };
  }
  queue.push(submissionId);
  pump();
  return { ok: true, waiting: queue.length + (running ? 1 : 0) };
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      try {
        await judgeOne(id);
      } catch (err) {
        console.error("judge failed", id, err);
        markError(id, String(err.message || err));
      }
    }
  } finally {
    running = false;
  }
}

function markError(id, message) {
  const db = getDb();
  db.prepare(
    `UPDATE submissions SET status = 'CE', score = 0, result_json = ?, judged_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify({ error: message, cases: [] }), id);
}

function normalize(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/g, "")
    .replace(/\n+$/g, "");
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
}

function runSpawn(command, args, options) {
  const { cwd, input, timeoutMs, env } = options;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env, LANG: "C" },
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child);
      resolve({ code: null, stdout, stderr, timeout: true, error: null });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
      if (stdout.length > 2_000_000) stdout = stdout.slice(0, 2_000_000);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
      if (stderr.length > 200_000) stderr = stderr.slice(0, 200_000);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, timeout: false, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timeout: false, error: null });
    });
    if (input != null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function whichPython() {
  return process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
}

function whichGxx() {
  return process.env.CXX || "g++";
}

async function compileCpp(src, exe, timeMs) {
  return runSpawn(whichGxx(), ["-std=c++17", "-O2", "-pipe", src, "-o", exe], {
    cwd: path.dirname(src),
    input: "",
    timeoutMs: Math.max(timeMs, 15000),
  });
}

async function runBinary(exe, input, timeMs) {
  if (process.platform === "win32") {
    return runSpawn(exe, [], { cwd: path.dirname(exe), input, timeoutMs: timeMs });
  }
  return runSpawn(exe, [], { cwd: path.dirname(exe), input, timeoutMs: timeMs });
}

async function runPython(src, input, timeMs) {
  return runSpawn(whichPython(), ["-I", src], {
    cwd: path.dirname(src),
    input,
    timeoutMs: timeMs,
  });
}

function readCase(problemId, rel) {
  return fs.readFileSync(path.join(PROBLEM_DATA_DIR, String(problemId), rel), "utf8");
}

async function judgeOne(id) {
  const db = getDb();
  const sub = db.prepare("SELECT * FROM submissions WHERE id = ?").get(id);
  if (!sub) return;
  const problem = db.prepare("SELECT * FROM problems WHERE id = ?").get(sub.problem_id);
  if (!problem) {
    markError(id, "题目不存在");
    return;
  }

  if (problem.type === "choice") {
    let spec = {};
    try {
      spec = JSON.parse(problem.choice_json || "{}");
    } catch {
      spec = {};
    }
    const answer = String(spec.answer || "").trim();
    if (!answer) {
      db.prepare(
        `UPDATE submissions SET status = 'submitted', score = NULL, result_json = ?, judged_at = datetime('now') WHERE id = ?`,
      ).run(JSON.stringify({ unscored: true, error: "本题暂无标准答案，已记下作答，不评分。" }), id);
      return;
    }
    const ok = String(sub.code || "").trim().toUpperCase() === answer.toUpperCase();
    const score = ok ? problem.full_score : 0;
    db.prepare(
      `UPDATE submissions SET status = ?, score = ?, result_json = ?, judged_at = datetime('now') WHERE id = ?`,
    ).run(ok ? "AC" : "WA", score, JSON.stringify({ cases: [{ seq: 1, result: ok ? "AC" : "WA", score }] }), id);
    return;
  }

    const sampleOnly = sub.mode === "sample";
  let cases = db
    .prepare(
      `SELECT * FROM testcases WHERE problem_id = ? AND (? = 1 AND is_sample = 1 OR ? = 0 AND is_sample = 0)
       ORDER BY seq`,
    )
    .all(problem.id, sampleOnly ? 1 : 0, sampleOnly ? 1 : 0);

  let unofficial = sampleOnly;
  if (!sampleOnly && cases.length === 0) {
    cases = db.prepare(`SELECT * FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY seq`).all(problem.id);
    unofficial = true;
  }
  if (cases.length === 0) {
    db.prepare(
      `UPDATE submissions SET status = 'submitted', score = NULL, result_json = ?, judged_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify({ unscored: true, error: "本题暂无测试数据，已记下作答，不评分。" }), id);
    return;
  }

  const work = path.join(RUNTIME_DIR, "tmp", `sub-${id}-${Date.now()}`);
  fs.mkdirSync(work, { recursive: true });
  const lang = sub.language;
  let runFn;
  try {
    if (lang === "cpp") {
      const src = path.join(work, "main.cpp");
      const exe = path.join(work, process.platform === "win32" ? "main.exe" : "main");
      fs.writeFileSync(src, sub.code);
      const compiled = await compileCpp(src, exe, 20000);
      if (compiled.error) {
        markError(id, `找不到编译器：${compiled.error}`);
        return;
      }
      if (compiled.timeout) {
        markError(id, "编译超时");
        return;
      }
      if (compiled.code !== 0) {
        db.prepare(
          `UPDATE submissions SET status='CE', score=0, result_json=?, judged_at=datetime('now') WHERE id=?`,
        ).run(JSON.stringify({ error: compiled.stderr || "编译失败", cases: [] }), id);
        return;
      }
      runFn = (input) => runBinary(exe, input, problem.time_ms + 200);
    } else if (lang === "python") {
      const src = path.join(work, "main.py");
      fs.writeFileSync(src, sub.code);
      runFn = (input) => runPython(src, input, problem.time_ms + 400);
    } else {
      markError(id, "不支持的语言");
      return;
    }

    const caseResults = [];
    let total = 0;
    for (const tc of cases) {
      let input = "";
      let expected = "";
      try {
        input = readCase(problem.id, tc.input_rel);
        expected = readCase(problem.id, tc.output_rel);
      } catch (err) {
        caseResults.push({ seq: tc.seq, result: "IE", score: 0, message: "测例文件缺失" });
        continue;
      }
      const ran = await runFn(input);
      let result = "AC";
      let gotScore = tc.score;
      if (ran.error) {
        result = "RE";
        gotScore = 0;
      } else if (ran.timeout) {
        result = "TLE";
        gotScore = 0;
      } else if (ran.code !== 0) {
        result = "RE";
        gotScore = 0;
      } else if (normalize(ran.stdout) !== normalize(expected)) {
        result = "WA";
        gotScore = 0;
      }
      total += gotScore;
      caseResults.push({ seq: tc.seq, result, score: gotScore, is_sample: tc.is_sample });
    }
    if (sampleOnly) {
      const allAc = caseResults.length && caseResults.every((c) => c.result === "AC");
      db.prepare(
        `UPDATE submissions SET status=?, score=?, result_json=?, judged_at=datetime('now') WHERE id=?`,
      ).run(allAc ? "AC" : caseResults[0]?.result || "WA", allAc ? 0 : 0, JSON.stringify({ unofficial: true, cases: caseResults }), id);
      return;
    }
    if (unofficial) {
      const allAc = caseResults.length && caseResults.every((c) => c.result === "AC");
      const score = allAc ? problem.full_score : 0;
      db.prepare(
        `UPDATE submissions SET status=?, score=?, result_json=?, judged_at=datetime('now') WHERE id=?`,
      ).run(allAc ? "AC" : caseResults[0]?.result || "WA", score, JSON.stringify({ unofficial: true, cases: caseResults }), id);
      return;
    }
    const status = total >= problem.full_score ? "AC" : total > 0 ? "PART" : caseResults[0]?.result || "WA";
    db.prepare(
      `UPDATE submissions SET status=?, score=?, result_json=?, judged_at=datetime('now') WHERE id=?`,
    ).run(status, total, JSON.stringify({ cases: caseResults }), id);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
