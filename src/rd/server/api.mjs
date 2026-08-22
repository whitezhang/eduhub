import { getDb } from "./db.mjs";
import { sendJson, readJsonBody } from "./http-util.mjs";
import { userFromRequest, login, createStudent, updateDisplayName, deleteStudent, logout, cookieHeader, clearCookieHeader, requireCoach, requireUser } from "./auth.mjs";
import {
  handleChallengeRoutes,
  guardListAccess,
  guardProtectedAccess,
  guardRequireLogin,
  guardAuthAccess,
} from "./guard.mjs";
import { enqueue, queueStatus } from "./judge.mjs";
import {
  applyCatalog,
  exportProblemToCatalog,
  listCatalogFiles,
  loadTestcasesWithContent,
  saveProblemFromBody,
  updateCatalogPublished,
} from "./catalog.mjs";
import fs from "node:fs";

function contestState(c, now = Date.now()) {
  const s = new Date(c.start_at).getTime();
  const e = new Date(c.end_at).getTime();
  if (now < s) return "upcoming";
  if (now > e) return "ended";
  return "running";
}

function hideCode(sub, viewer, contest) {
  const out = { ...sub };
  const isOwner = viewer && viewer.id === sub.user_id;
  const isCoach = viewer && viewer.role === "coach";
  if (!isOwner && !isCoach) delete out.code;
  if (contest && contest.rule === "oi" && contestState(contest) === "running" && !isCoach) {
    out.status = "submitted";
    out.score = null;
    out.result_json = null;
    delete out.code;
  }
  return out;
}

/** Choice/TF: non-empty answer key. Traditional: non-empty reference solution (满分程序). */
function hasAnswerSql(alias = "problems") {
  return `(
    (
      ${alias}.type = 'choice'
      AND length(trim(coalesce(json_extract(${alias}.choice_json, '$.answer'), ''))) > 0
    )
    OR (
      ${alias}.type = 'traditional'
      AND length(trim(coalesce(${alias}.solution_code, ''))) > 0
    )
  )`;
}

function problemHasAnswer(db, p) {
  if (!p) return false;
  if (p.type === "choice") {
    try {
      return Boolean(String(JSON.parse(p.choice_json || "{}").answer || "").trim());
    } catch {
      return false;
    }
  }
  return Boolean(String(p.solution_code || "").trim());
}

function studentCanSeeProblem(db, p, me) {
  if (!p) return false;
  if (me?.role === "coach") return true;
  return p.published === 1;
}

function visibleContestProblems(db, contest, me) {
  let sql = `SELECT p.id, p.code, p.title, p.full_score, p.type, cp.seq,
      CASE WHEN ${hasAnswerSql("p")} THEN 1 ELSE 0 END AS has_answer
     FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
     WHERE cp.contest_id = ?`;
  if (me?.role !== "coach") {
    sql += ` AND p.published = 1`;
  }
  sql += " ORDER BY cp.seq";
  return db.prepare(sql).all(contest.id);
}

function annotatePaperProblems(db, contestId, problems, me) {
  const base = problems.map((p) => ({ ...p, my_score: null, has_draft: 0 }));
  if (!me || !base.length) return { problems: base, last_problem_id: null };
  const ids = base.map((p) => p.id);
  const ph = ids.map(() => "?").join(",");
  const scoreRows = db
    .prepare(
      `SELECT problem_id, MAX(score) AS score FROM submissions
       WHERE user_id = ? AND mode = 'full' AND status NOT IN ('queued','judging')
         AND problem_id IN (${ph})
       GROUP BY problem_id`,
    )
    .all(me.id, ...ids);
  const scoreMap = {};
  for (const r of scoreRows) scoreMap[r.problem_id] = r.score;
  const draftRows = db
    .prepare(
      `SELECT problem_id FROM paper_drafts WHERE user_id = ? AND contest_id = ? AND problem_id IN (${ph})`,
    )
    .all(me.id, contestId, ...ids);
  const drafts = new Set(draftRows.map((r) => r.problem_id));
  const cursor = db
    .prepare("SELECT problem_id FROM paper_cursors WHERE user_id = ? AND contest_id = ?")
    .get(me.id, contestId);
  return {
    problems: base.map((p) => ({
      ...p,
      my_score: Object.prototype.hasOwnProperty.call(scoreMap, p.id) ? scoreMap[p.id] : null,
      has_draft: drafts.has(p.id) ? 1 : 0,
    })),
    last_problem_id: cursor ? cursor.problem_id : null,
  };
}

function paperContext(db, problemId, me, contestId) {
  let contest = null;
  if (contestId) {
    contest = db.prepare("SELECT * FROM contests WHERE id = ?").get(contestId);
    if (contest && contest.published !== 1 && me?.role !== "coach") contest = null;
  }
  if (!contest) {
    const rows = db
      .prepare(
        `SELECT c.* FROM contest_problems cp
         JOIN contests c ON c.id = cp.contest_id
         WHERE cp.problem_id = ?
         ORDER BY c.published DESC, c.id`,
      )
      .all(problemId);
    contest = rows.find((c) => c.published === 1 || me?.role === "coach") || null;
  }
  if (!contest) return null;
  const raw = visibleContestProblems(db, contest, me);
  if (!raw.some((row) => row.id === problemId)) return null;
  const ann = annotatePaperProblems(db, contest.id, raw, me);
  return { id: contest.id, title: contest.title, last_problem_id: ann.last_problem_id, problems: ann.problems };
}

function savePaperProgress(db, me, contestId, problemId, language, code) {
  const text = String(code || "");
  if (text.trim()) {
    db.prepare(
      `INSERT INTO paper_drafts (user_id, contest_id, problem_id, language, code, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, contest_id, problem_id) DO UPDATE SET
         language = excluded.language, code = excluded.code, updated_at = excluded.updated_at`,
    ).run(me.id, contestId, problemId, language || "", text);
  }
  db.prepare(
    `INSERT INTO paper_cursors (user_id, contest_id, problem_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, contest_id) DO UPDATE SET
       problem_id = excluded.problem_id, updated_at = excluded.updated_at`,
  ).run(me.id, contestId, problemId);
}

export async function handleApi(req, res, pathname, query) {
  const db = getDb();
  const method = req.method || "GET";
  const me = userFromRequest(req);

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (await handleChallengeRoutes(req, res, method, pathname)) {
    return true;
  }

  if (method === "GET" && pathname === "/api/session") {
    sendJson(res, 200, { user: me });
    return true;
  }

  if (method === "PATCH" && pathname === "/api/session") {
    const u = requireUser(req);
    if (!u) {
      sendJson(res, 401, { error: "请先登录" });
      return true;
    }
    const body = await readJsonBody(req);
    const got = updateDisplayName(u.id, body.display_name);
    if (got.error) {
      sendJson(res, 400, { error: got.error });
      return true;
    }
    sendJson(res, 200, { user: got.user });
    return true;
  }

  if (method === "POST" && pathname === "/api/login") {
    if (!guardAuthAccess(req, res)) return true;
    const body = await readJsonBody(req);
    const got = login(body.username, body.password);
    if (!got) {
      sendJson(res, 401, { error: "用户名或密码不正确" });
      return true;
    }
    sendJson(res, 200, { user: got.user }, { "Set-Cookie": cookieHeader(got.sid, req) });
    return true;
  }

  if (method === "POST" && pathname === "/api/logout") {
    logout(req);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": clearCookieHeader() });
    return true;
  }

  if (method === "GET" && pathname === "/api/cms") {
    const rows = db.prepare("SELECT key, body FROM cms_blocks").all();
    const cms = {};
    for (const r of rows) {
      if (r.key === "syllabus" || r.key === "timeline" || r.key === "syllabus_meta") {
        try {
          const parsed = JSON.parse(r.body);
          if (r.key === "syllabus_meta") {
            if (parsed.csp_compare) cms.csp_compare = parsed.csp_compare;
            if (parsed.gesp_csp_bridge) cms.gesp_csp_bridge = parsed.gesp_csp_bridge;
          } else {
            cms[r.key] = parsed;
          }
        } catch {
          if (r.key !== "syllabus_meta") cms[r.key] = [];
        }
      } else cms[r.key] = r.body;
    }
    if (query.scope === "home") {
      if (!guardListAccess(req, res, me)) return true;
      const syllabus = Array.isArray(cms.syllabus)
        ? cms.syllabus.map((s) => ({ slug: s.slug, title: s.title, blurb: s.blurb }))
        : [];
      sendJson(res, 200, {
        benefits: cms.benefits,
        timeline: cms.timeline,
        gesp_csp_bridge: cms.gesp_csp_bridge,
        csp_compare: cms.csp_compare,
        syllabus,
      });
      return true;
    }
    if (!guardProtectedAccess(req, res, me)) return true;
    sendJson(res, 200, cms);
    return true;
  }

  const knowledgeMatch = pathname.match(/^\/api\/knowledge\/([a-z0-9-]+)$/i);
  if (method === "GET" && knowledgeMatch) {
    if (!guardProtectedAccess(req, res, me)) return true;
    const row = db.prepare("SELECT body FROM cms_blocks WHERE key = 'knowledge_topics'").get();
    if (!row) {
      sendJson(res, 404, { error: "知识点库未导入" });
      return true;
    }
    let map = {};
    try {
      map = JSON.parse(row.body || "{}");
    } catch {
      map = {};
    }
    const topic = map[knowledgeMatch[1]];
    if (!topic) {
      sendJson(res, 404, { error: "知识点不存在" });
      return true;
    }
    sendJson(res, 200, topic);
    return true;
  }

  if (method === "GET" && pathname === "/api/problem-lists") {
    if (!guardProtectedAccess(req, res, me)) return true;
    sendJson(res, 200, { lists: db.prepare("SELECT * FROM problem_lists ORDER BY id").all() });
    return true;
  }

  if (method === "GET" && pathname === "/api/problems") {
    if (!guardProtectedAccess(req, res, me)) return true;
    const source = query.source || "";
    const q = String(query.q || "").trim();
    let sql = `SELECT id, code, title, source, difficulty, full_score, type,
      CASE WHEN ${hasAnswerSql()} THEN 1 ELSE 0 END AS has_answer
      FROM problems WHERE published = 1`;
    if (me?.role === "coach" && query.all === "1") {
      sql = `SELECT id, code, title, source, difficulty, full_score, type, published, review_note,
        CASE WHEN ${hasAnswerSql()} THEN 1 ELSE 0 END AS has_answer
        FROM problems WHERE 1=1`;
    }
    const params = [];
    if (source) {
      sql += " AND source = ?";
      params.push(source);
    }
    if (q) {
      sql += " AND (code LIKE ? OR title LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += " ORDER BY code";
    const rows = db.prepare(sql).all(...params);
    let scores = {};
    if (me) {
      const mine = db
        .prepare(
          `SELECT problem_id, MAX(score) AS score FROM submissions
           WHERE user_id = ? AND mode = 'full' AND status NOT IN ('queued','judging')
           GROUP BY problem_id`,
        )
        .all(me.id);
      for (const r of mine) scores[r.problem_id] = r.score;
    }
    sendJson(
      res,
      200,
      {
        problems: rows.map((p) => ({
          ...p,
          my_score: Object.prototype.hasOwnProperty.call(scores, p.id) ? scores[p.id] : null,
        })),
      },
    );
    return true;
  }

  const problemMatch = pathname.match(/^\/api\/problems\/(\d+)$/);
  if (method === "GET" && problemMatch) {
    if (!guardProtectedAccess(req, res, me)) return true;
    const p = db.prepare("SELECT * FROM problems WHERE id = ?").get(Number(problemMatch[1]));
    if (!studentCanSeeProblem(db, p, me)) {
      sendJson(res, 404, { error: "题目不存在" });
      return true;
    }
    const cases = db
      .prepare("SELECT seq, score, is_sample FROM testcases WHERE problem_id = ? ORDER BY seq")
      .all(p.id);
    const out = {
      ...p,
      has_answer: problemHasAnswer(db, p) ? 1 : 0,
      languages: JSON.parse(p.languages || "[]"),
      choice: p.choice_json ? JSON.parse(p.choice_json) : null,
      subtasks: cases.filter((c) => !c.is_sample),
    };
    delete out.choice_json;
    if (out.choice && me?.role !== "coach") delete out.choice.answer;
    out.paper = paperContext(db, p.id, me, query.contest ? Number(query.contest) : 0);
    out.draft = null;
    if (me && out.paper) {
      out.draft = db
        .prepare(
          "SELECT language, code FROM paper_drafts WHERE user_id = ? AND contest_id = ? AND problem_id = ?",
        )
        .get(me.id, out.paper.id, p.id);
    }
    sendJson(res, 200, out);
    return true;
  }

  if (method === "GET" && pathname === "/api/judge/queue") {
    sendJson(res, 200, queueStatus());
    return true;
  }

  if (method === "POST" && pathname === "/api/submissions") {
    if (!me) {
      sendJson(res, 401, { error: "请先登录" });
      return true;
    }
    const body = await readJsonBody(req, 200_000);
    const problem = db.prepare("SELECT * FROM problems WHERE id = ?").get(Number(body.problem_id));
    if (!studentCanSeeProblem(db, problem, me)) {
      sendJson(res, 404, { error: "题目不存在" });
      return true;
    }
    const mode = body.mode === "sample" ? "sample" : "full";
    const language = problem.type === "choice" ? "choice" : body.language === "python" ? "python" : "cpp";
    if (problem.type === "traditional" && mode === "sample" && !problem.sample_in) {
      sendJson(res, 400, { error: "本题没有样例" });
      return true;
    }
    const contestId = body.contest_id ? Number(body.contest_id) : null;
    let contest = null;
    if (contestId) {
      contest = db.prepare("SELECT * FROM contests WHERE id = ?").get(contestId);
      if (!contest) {
        sendJson(res, 404, { error: "比赛不存在" });
        return true;
      }
      const st = contestState(contest);
      if (st !== "running") {
        sendJson(res, 400, { error: "比赛未在进行中" });
        return true;
      }
      db.prepare("INSERT OR IGNORE INTO contest_registrations (contest_id, user_id) VALUES (?, ?)").run(
        contestId,
        me.id,
      );
    }
    const info = db
      .prepare(
        `INSERT INTO submissions (user_id, problem_id, contest_id, language, mode, code, status)
         VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
      )
      .run(me.id, problem.id, contestId, language, mode, String(body.code || ""));
    const id = Number(info.lastInsertRowid);
    db.prepare("UPDATE submissions SET status = 'judging' WHERE id = ?").run(id);
    const q = enqueue(id);
    if (q.error) {
      db.prepare("DELETE FROM submissions WHERE id = ?").run(id);
      sendJson(res, 429, { error: q.error });
      return true;
    }
    sendJson(res, 200, { id, waiting: q.waiting });
    return true;
  }

  const subMatch = pathname.match(/^\/api\/submissions\/(\d+)$/);
  if (method === "GET" && subMatch) {
    if (!me) {
      sendJson(res, 401, { error: "请先登录" });
      return true;
    }
    const sub = db.prepare("SELECT * FROM submissions WHERE id = ?").get(Number(subMatch[1]));
    if (!sub) {
      sendJson(res, 404, { error: "提交不存在" });
      return true;
    }
    if (sub.user_id !== me.id && me.role !== "coach") {
      sendJson(res, 403, { error: "不能查看该提交" });
      return true;
    }
    let contest = null;
    if (sub.contest_id) contest = db.prepare("SELECT * FROM contests WHERE id = ?").get(sub.contest_id);
    const view = hideCode(sub, me, contest);
    if (view.result_json) {
      try {
        view.result = JSON.parse(view.result_json);
      } catch {
        view.result = null;
      }
    }
    delete view.result_json;
    sendJson(res, 200, view);
    return true;
  }

  if (method === "GET" && pathname === "/api/submissions") {
    if (!me) {
      sendJson(res, 401, { error: "请先登录" });
      return true;
    }
    const pid = Number(query.problem_id || 0);
    const rows = db
      .prepare(
        `SELECT id, language, mode, status, score, created_at FROM submissions
         WHERE user_id = ? AND (? = 0 OR problem_id = ?)
         ORDER BY id DESC LIMIT 30`,
      )
      .all(me.id, pid, pid);
    sendJson(res, 200, { submissions: rows });
    return true;
  }

  const paperSave = pathname.match(/^\/api\/papers\/(\d+)\/progress$/);
  if (method === "PUT" && paperSave) {
    if (!me) {
      sendJson(res, 401, { error: "请先登录" });
      return true;
    }
    const cid = Number(paperSave[1]);
    const contest = db.prepare("SELECT * FROM contests WHERE id = ?").get(cid);
    if (!contest || (contest.published !== 1 && me.role !== "coach")) {
      sendJson(res, 404, { error: "试卷不存在" });
      return true;
    }
    const body = await readJsonBody(req, 200_000);
    const pid = Number(body.problem_id);
    const inPaper = db.prepare("SELECT 1 FROM contest_problems WHERE contest_id = ? AND problem_id = ?").get(cid, pid);
    if (!inPaper) {
      sendJson(res, 400, { error: "题目不在本卷" });
      return true;
    }
    savePaperProgress(db, me, cid, pid, body.language, body.code);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (method === "GET" && pathname === "/api/contests") {
    if (!guardProtectedAccess(req, res, me)) return true;
    const source = String(query.source || "").trim();
    const q = String(query.q || "").trim().toLowerCase();
    const rows = db.prepare("SELECT * FROM contests WHERE published = 1 ORDER BY start_at DESC").all();
    const visibleCount = db.prepare(
      `SELECT COUNT(*) AS n FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
       WHERE cp.contest_id = ? AND p.published = 1`,
    );
    const missingAnswerCount = db.prepare(
      `SELECT COUNT(*) AS n FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
       WHERE cp.contest_id = ? AND p.published = 1 AND NOT (${hasAnswerSql("p")})`,
    );
    const sourceMatch = db.prepare(
      `SELECT COUNT(*) AS n FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
       WHERE cp.contest_id = ? AND p.source = ?`,
    );
    const contests = [];
    for (const c of rows) {
      if (source && !sourceMatch.get(c.id, source).n) continue;
      if (q && !String(c.title || "").toLowerCase().includes(q)) continue;
      const n = me?.role === "coach"
        ? db.prepare("SELECT COUNT(*) AS n FROM contest_problems WHERE contest_id = ?").get(c.id).n
        : visibleCount.get(c.id).n;
      if (n === 0) continue;
      const problems = visibleContestProblems(db, c, me);
      const ann = annotatePaperProblems(db, c.id, problems, me);
      const full = ann.problems.filter((p) => p.my_score != null && p.my_score >= (p.full_score || 100)).length;
      const done = ann.problems.filter((p) => p.my_score != null).length;
      const item = {
        ...c,
        state: contestState(c),
        problem_count: ann.problems.length || n,
        full_count: full,
        done_count: done,
        registered: me
          ? Boolean(db.prepare("SELECT 1 FROM contest_registrations WHERE contest_id=? AND user_id=?").get(c.id, me.id))
          : false,
      };
      if (me?.role === "coach") {
        item.missing_answer_count = missingAnswerCount.get(c.id).n;
      }
      contests.push(item);
    }
    sendJson(res, 200, { contests });
    return true;
  }

  const workbookMatch = pathname.match(/^\/api\/contests\/(\d+)\/workbook$/);
  if (method === "GET" && workbookMatch) {
    if (!guardProtectedAccess(req, res, me)) return true;
    const c = db.prepare("SELECT * FROM contests WHERE id = ?").get(Number(workbookMatch[1]));
    if (!c || (c.published !== 1 && me?.role !== "coach")) {
      sendJson(res, 404, { error: "试卷不存在" });
      return true;
    }
    const problems = visibleContestProblems(db, c, me);
    const ann = annotatePaperProblems(db, c.id, problems, me);
    const outProblems = [];
    for (const meta of ann.problems) {
      const p = db.prepare("SELECT * FROM problems WHERE id = ?").get(meta.id);
      if (!p || !studentCanSeeProblem(db, p, me)) continue;
      let choice = null;
      try {
        choice = p.choice_json ? JSON.parse(p.choice_json) : null;
      } catch {
        choice = null;
      }
      if (choice && me?.role !== "coach") delete choice.answer;
      let languages = [];
      try {
        languages = JSON.parse(p.languages || "[]");
      } catch {
        languages = [];
      }
      let draft = null;
      if (me) {
        draft = db
          .prepare(
            "SELECT language, code FROM paper_drafts WHERE user_id = ? AND contest_id = ? AND problem_id = ?",
          )
          .get(me.id, c.id, p.id);
      }
      outProblems.push({
        id: p.id,
        code: p.code,
        title: p.title,
        source: p.source,
        type: p.type,
        statement: p.statement,
        sample_in: p.sample_in,
        sample_out: p.sample_out,
        sample_note: p.sample_note,
        time_ms: p.time_ms,
        memory_mb: p.memory_mb,
        io_mode: p.io_mode,
        full_score: p.full_score,
        languages,
        choice,
        has_answer: problemHasAnswer(db, p) ? 1 : 0,
        my_score: meta.my_score,
        has_draft: meta.has_draft,
        seq: meta.seq,
        draft,
      });
    }
    sendJson(res, 200, {
      id: c.id,
      title: c.title,
      rule: c.rule,
      duration_min: c.duration_min,
      start_at: c.start_at,
      end_at: c.end_at,
      state: contestState(c),
      problems: outProblems,
      last_problem_id: ann.last_problem_id,
    });
    return true;
  }

  const contestMatch = pathname.match(/^\/api\/contests\/(\d+)$/);
  if (method === "GET" && contestMatch) {
    if (!guardProtectedAccess(req, res, me)) return true;
    const c = db.prepare("SELECT * FROM contests WHERE id = ?").get(Number(contestMatch[1]));
    if (!c || (c.published !== 1 && me?.role !== "coach")) {
      sendJson(res, 404, { error: "比赛不存在" });
      return true;
    }
    const problems = visibleContestProblems(db, c, me);
    const ann = annotatePaperProblems(db, c.id, problems, me);
    const registered = me
      ? Boolean(db.prepare("SELECT 1 FROM contest_registrations WHERE contest_id=? AND user_id=?").get(c.id, me.id))
      : false;
    sendJson(res, 200, {
      ...c,
      state: contestState(c),
      problems: ann.problems,
      last_problem_id: ann.last_problem_id,
      registered,
      now: new Date().toISOString(),
    });
    return true;
  }

  const contestReg = pathname.match(/^\/api\/contests\/(\d+)\/register$/);
  if (method === "POST" && contestReg) {
    if (!me) {
      sendJson(res, 401, { error: "请先登录" });
      return true;
    }
    const c = db.prepare("SELECT * FROM contests WHERE id = ?").get(Number(contestReg[1]));
    if (!c) {
      sendJson(res, 404, { error: "比赛不存在" });
      return true;
    }
    db.prepare("INSERT OR IGNORE INTO contest_registrations (contest_id, user_id) VALUES (?, ?)").run(c.id, me.id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const boardMatch = pathname.match(/^\/api\/contests\/(\d+)\/board$/);
  if (method === "GET" && boardMatch) {
    const c = db.prepare("SELECT * FROM contests WHERE id = ?").get(Number(boardMatch[1]));
    if (!c) {
      sendJson(res, 404, { error: "比赛不存在" });
      return true;
    }
    if (contestState(c) === "running" && c.rule === "oi") {
      sendJson(res, 200, { hidden: true, rows: [] });
      return true;
    }
    const problems = db
      .prepare("SELECT problem_id FROM contest_problems WHERE contest_id = ? ORDER BY seq")
      .all(c.id);
    const users = db
      .prepare("SELECT user_id FROM contest_registrations WHERE contest_id = ?")
      .all(c.id);
    const rows = [];
    for (const u of users) {
      const user = db.prepare("SELECT id, display_name, username FROM users WHERE id = ?").get(u.user_id);
      const scores = {};
      let total = 0;
      for (const p of problems) {
        let sc;
        if (c.rule === "ioi") {
          sc = db
            .prepare(
              `SELECT MAX(score) AS s FROM submissions WHERE contest_id=? AND user_id=? AND problem_id=? AND mode='full'`,
            )
            .get(c.id, u.user_id, p.problem_id);
        } else {
          sc = db
            .prepare(
              `SELECT score AS s FROM submissions WHERE contest_id=? AND user_id=? AND problem_id=? AND mode='full'
               ORDER BY id DESC LIMIT 1`,
            )
            .get(c.id, u.user_id, p.problem_id);
        }
        const val = sc && sc.s != null ? sc.s : 0;
        scores[p.problem_id] = val;
        total += val;
      }
      rows.push({ user, total, scores });
    }
    rows.sort((a, b) => b.total - a.total);
    sendJson(res, 200, { hidden: false, rows, problems });
    return true;
  }

  if (method === "GET" && pathname === "/api/external") {
    if (!guardProtectedAccess(req, res, me)) return true;
    sendJson(res, 200, { events: db.prepare("SELECT * FROM external_events ORDER BY seq").all() });
    return true;
  }

  if (method === "GET" && pathname === "/api/progress") {
    if (!guardProtectedAccess(req, res, me)) return true;
    const students = db.prepare("SELECT id, username, display_name FROM users WHERE role = 'student'").all();
    const totalP = db
      .prepare(`SELECT COUNT(*) AS c FROM problems WHERE published = 1 AND type = 'traditional' AND ${hasAnswerSql()}`)
      .get().c;
    const list = students.map((s) => {
      const agg = db
        .prepare(
          `SELECT problem_id, MAX(score) AS score FROM submissions
           WHERE user_id = ? AND mode = 'full' AND status NOT IN ('queued','judging')
           GROUP BY problem_id`,
        )
        .all(s.id);
      let full = 0;
      let part = 0;
      for (const a of agg) {
        const fp = db.prepare("SELECT full_score FROM problems WHERE id = ?").get(a.problem_id);
        if (!fp) continue;
        if (a.score >= fp.full_score) full += 1;
        else if (a.score > 0) part += 1;
      }
      const last = db
        .prepare(`SELECT created_at FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
        .get(s.id);
      const lastC = db
        .prepare(
          `SELECT c.title, s.score FROM submissions s JOIN contests c ON c.id = s.contest_id
           WHERE s.user_id = ? AND s.contest_id IS NOT NULL ORDER BY s.id DESC LIMIT 1`,
        )
        .get(s.id);
      return {
        id: s.id,
        display_name: s.display_name,
        username: s.username,
        full,
        part,
        untouched: Math.max(0, totalP - full - part),
        last_submit: last ? last.created_at : null,
        last_contest: lastC ? `${lastC.title} ${lastC.score ?? ""}` : "—",
      };
    });
    list.sort((a, b) => String(b.last_submit || "").localeCompare(String(a.last_submit || "")));
    sendJson(res, 200, { students: list });
    return true;
  }

  const progMatch = pathname.match(/^\/api\/progress\/(\d+)$/);
  if (method === "GET" && progMatch) {
    if (!guardProtectedAccess(req, res, me)) return true;
    const s = db.prepare("SELECT id, username, display_name FROM users WHERE id = ? AND role = 'student'").get(Number(progMatch[1]));
    if (!s) {
      sendJson(res, 404, { error: "没有这位用户" });
      return true;
    }
    const problems = db
      .prepare(`SELECT id, code, title, full_score FROM problems WHERE published = 1 AND ${hasAnswerSql()}`)
      .all();
    const scores = problems.map((p) => {
      const r = db
        .prepare(
          `SELECT MAX(score) AS score FROM submissions WHERE user_id = ? AND problem_id = ? AND mode = 'full'`,
        )
        .get(s.id, p.id);
      return { id: p.id, code: p.code, title: p.title, full_score: p.full_score, score: r && r.score != null ? r.score : null };
    });
    sendJson(res, 200, { user: s, problems: scores });
    return true;
  }

  if (pathname.startsWith("/api/studio/")) {
    const coach = requireCoach(req);
    if (!coach) {
      sendJson(res, 403, { error: "需要教练账号" });
      return true;
    }
    if (method === "PUT" && pathname === "/api/studio/cms") {
      const body = await readJsonBody(req, 200_000);
      const keys = ["benefits", "syllabus", "timeline"];
      for (const k of keys) {
        if (body[k] == null) continue;
        const val = typeof body[k] === "string" ? body[k] : JSON.stringify(body[k]);
        db.prepare("INSERT INTO cms_blocks (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body").run(k, val);
      }
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === "GET" && pathname === "/api/studio/users") {
      sendJson(
        res,
        200,
        {
          users: db
            .prepare(
              `SELECT id, username, display_name, role, grade,
                      CASE WHEN role = 'student' THEN password_plain ELSE NULL END AS password_plain
               FROM users ORDER BY id`,
            )
            .all(),
        },
      );
      return true;
    }
    if (method === "POST" && pathname === "/api/studio/users") {
      const got = createStudent();
      if (got.error) {
        sendJson(res, 400, { error: got.error });
        return true;
      }
      sendJson(res, 200, { user: got.user, password: got.password });
      return true;
    }
    const studioUserOne = pathname.match(/^\/api\/studio\/users\/(\d+)$/);
    if (method === "DELETE" && studioUserOne) {
      const got = deleteStudent(studioUserOne[1]);
      if (got.error) {
        sendJson(res, 400, { error: got.error });
        return true;
      }
      sendJson(res, 200, { ok: true, username: got.username });
      return true;
    }
    if (method === "GET" && pathname === "/api/studio/problems") {
      const rows = db
        .prepare(
          `SELECT id, code, title, source, difficulty, type, published, review_note, full_score,
            CASE WHEN ${hasAnswerSql()} THEN 1 ELSE 0 END AS has_answer
           FROM problems ORDER BY has_answer ASC, code`,
        )
        .all();
      sendJson(res, 200, { problems: rows });
      return true;
    }
    const studioProblemOne = pathname.match(/^\/api\/studio\/problems\/(\d+)$/);
    if (method === "GET" && studioProblemOne) {
      const pid = Number(studioProblemOne[1]);
      const p = db.prepare("SELECT * FROM problems WHERE id = ?").get(pid);
      if (!p) {
        sendJson(res, 404, { error: "题目不存在" });
        return true;
      }
      let choice = null;
      try {
        choice = p.choice_json ? JSON.parse(p.choice_json) : null;
      } catch {
        choice = null;
      }
      let languages = [];
      try {
        languages = JSON.parse(p.languages || "[]");
      } catch {
        languages = [];
      }
      const testcases = loadTestcasesWithContent(db, pid);
      const out = {
        ...p,
        languages,
        choice,
        has_answer: problemHasAnswer(db, p) ? 1 : 0,
        testcases,
      };
      delete out.choice_json;
      sendJson(res, 200, out);
      return true;
    }
    if (method === "PUT" && studioProblemOne) {
      const pid = Number(studioProblemOne[1]);
      try {
        const body = await readJsonBody(req, 5_000_000);
        const { problem, catalog_path } = saveProblemFromBody(db, pid, body);
        sendJson(res, 200, {
          ok: true,
          id: problem.id,
          code: problem.code,
          catalog_path,
          message: "已写入本地库与 catalog；上线请 git add/commit/push 后部署",
        });
      } catch (e) {
        sendJson(res, 400, { error: e.message || String(e) });
      }
      return true;
    }
    if (method === "POST" && pathname === "/api/studio/catalog/export") {
      try {
        const body = await readJsonBody(req);
        if (body.id != null) {
          const got = exportProblemToCatalog(db, Number(body.id));
          sendJson(res, 200, { ok: true, exported: 1, ...got });
          return true;
        }
        if (body.all) {
          const ids = db.prepare("SELECT id FROM problems ORDER BY code").all().map((r) => r.id);
          let n = 0;
          for (const id of ids) {
            exportProblemToCatalog(db, id);
            n += 1;
          }
          sendJson(res, 200, { ok: true, exported: n });
          return true;
        }
        const files = listCatalogFiles();
        let n = 0;
        for (const fp of files) {
          const doc = JSON.parse(fs.readFileSync(fp, "utf8"));
          const row = db.prepare("SELECT id FROM problems WHERE code = ?").get(doc.code);
          if (row) {
            exportProblemToCatalog(db, row.id);
            n += 1;
          }
        }
        sendJson(res, 200, { ok: true, exported: n });
      } catch (e) {
        sendJson(res, 400, { error: e.message || String(e) });
      }
      return true;
    }
    if (method === "POST" && pathname === "/api/studio/catalog/apply") {
      const result = applyCatalog(db);
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    if (method === "GET" && pathname === "/api/studio/contests") {
      const rows = db.prepare("SELECT * FROM contests ORDER BY published ASC, title").all();
      const statsSql = db.prepare(
        `SELECT COUNT(*) AS n,
          SUM(CASE WHEN ${hasAnswerSql("p")} THEN 1 ELSE 0 END) AS answered
         FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
         WHERE cp.contest_id = ?`,
      );
      const contests = rows.map((c) => {
        const s = statsSql.get(c.id);
        return {
          ...c,
          problem_count: s.n,
          answered_count: s.answered || 0,
        };
      });
      sendJson(res, 200, { contests });
      return true;
    }
    const studioContestOne = pathname.match(/^\/api\/studio\/contests\/(\d+)$/);
    if (method === "GET" && studioContestOne) {
      const c = db.prepare("SELECT * FROM contests WHERE id = ?").get(Number(studioContestOne[1]));
      if (!c) {
        sendJson(res, 404, { error: "试卷不存在" });
        return true;
      }
      const problems = db
        .prepare(
          `SELECT p.id, p.code, p.title, p.type, p.published, cp.seq,
            CASE WHEN ${hasAnswerSql("p")} THEN 1 ELSE 0 END AS has_answer
           FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
           WHERE cp.contest_id = ? ORDER BY cp.seq`,
        )
        .all(c.id);
      sendJson(res, 200, {
        ...c,
        problems,
        problem_count: problems.length,
        answered_count: problems.filter((p) => p.has_answer).length,
      });
      return true;
    }
    const pubMatch = pathname.match(/^\/api\/studio\/contests\/(\d+)\/publish$/);
    if (method === "POST" && pubMatch) {
      const cid = Number(pubMatch[1]);
      const c = db.prepare("SELECT * FROM contests WHERE id = ?").get(cid);
      if (!c) {
        sendJson(res, 404, { error: "比赛不存在" });
        return true;
      }
      db.prepare("UPDATE contests SET published = 1 WHERE id = ?").run(cid);
      db.prepare(
        `UPDATE problems SET published = 1 WHERE id IN (SELECT problem_id FROM contest_problems WHERE contest_id = ?)`,
      ).run(cid);
      sendJson(res, 200, { ok: true });
      return true;
    }
    const unpubMatch = pathname.match(/^\/api\/studio\/contests\/(\d+)\/unpublish$/);
    if (method === "POST" && unpubMatch) {
      const cid = Number(unpubMatch[1]);
      db.prepare("UPDATE contests SET published = 0 WHERE id = ?").run(cid);
      db.prepare(
        `UPDATE problems SET published = 0 WHERE id IN (SELECT problem_id FROM contest_problems WHERE contest_id = ?)`,
      ).run(cid);
      sendJson(res, 200, { ok: true });
      return true;
    }
    const patchProb = pathname.match(/^\/api\/studio\/problems\/(\d+)$/);
    if (method === "PATCH" && patchProb) {
      const body = await readJsonBody(req);
      const pid = Number(patchProb[1]);
      const p = db.prepare("SELECT id, code, published FROM problems WHERE id = ?").get(pid);
      if (!p) {
        sendJson(res, 404, { error: "题目不存在" });
        return true;
      }
      if (body.published != null) {
        const pub = body.published ? 1 : 0;
        db.prepare("UPDATE problems SET published = ? WHERE id = ?").run(pub, pid);
        updateCatalogPublished(p.code, pub);
      }
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === "POST" && pathname === "/api/studio/contests") {
      const body = await readJsonBody(req);
      if (!body.title || !body.rule || !body.start_at || !body.end_at) {
        sendJson(res, 400, { error: "缺少字段" });
        return true;
      }
      const info = db
        .prepare(
          `INSERT INTO contests (title, rule, duration_min, start_at, end_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(body.title, body.rule, Number(body.duration_min || 120), body.start_at, body.end_at);
      const cid = Number(info.lastInsertRowid);
      const pids = Array.isArray(body.problem_ids) ? body.problem_ids : [];
      pids.forEach((pid, i) => {
        db.prepare("INSERT INTO contest_problems (contest_id, problem_id, seq) VALUES (?,?,?)").run(cid, Number(pid), i + 1);
      });
      sendJson(res, 200, { id: cid });
      return true;
    }
    sendJson(res, 404, { error: "无此管理接口" });
    return true;
  }

  return false;
}
