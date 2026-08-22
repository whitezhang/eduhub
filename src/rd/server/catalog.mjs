import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, PROBLEM_DATA_DIR } from "./db.mjs";

export const CATALOG_DIR = path.join(DATA_DIR, "catalog", "problems");

export function ensureCatalogDir() {
  fs.mkdirSync(CATALOG_DIR, { recursive: true });
}

export function safeCodeFilename(code) {
  return String(code || "unknown").replace(/[^\w.\-]+/g, "_");
}

export function catalogPathForCode(code) {
  return path.join(CATALOG_DIR, `${safeCodeFilename(code)}.json`);
}

function readCaseFile(problemId, rel) {
  const fp = path.join(PROBLEM_DATA_DIR, String(problemId), rel);
  if (!fs.existsSync(fp)) return "";
  return fs.readFileSync(fp, "utf8");
}

export function loadTestcasesWithContent(db, problemId) {
  const rows = db
    .prepare("SELECT seq, score, is_sample, input_rel, output_rel FROM testcases WHERE problem_id = ? ORDER BY seq")
    .all(problemId);
  return rows.map((r) => ({
    seq: r.seq,
    score: r.score,
    is_sample: r.is_sample ? 1 : 0,
    input: readCaseFile(problemId, r.input_rel),
    output: readCaseFile(problemId, r.output_rel),
  }));
}

export function problemToCatalogDoc(p, testcases) {
  let choice = null;
  if (p.choice_json) {
    try {
      choice = typeof p.choice_json === "string" ? JSON.parse(p.choice_json) : p.choice_json;
    } catch {
      choice = null;
    }
  } else if (p.choice) {
    choice = p.choice;
  }
  let languages = p.languages;
  if (typeof languages === "string") {
    try {
      languages = JSON.parse(languages || "[]");
    } catch {
      languages = [];
    }
  }
  if (!Array.isArray(languages)) languages = [];
  return {
    code: p.code,
    title: p.title,
    source: p.source,
    difficulty: p.difficulty,
    time_ms: Number(p.time_ms) || 0,
    memory_mb: Number(p.memory_mb) || 0,
    io_mode: p.io_mode || "stdin",
    languages,
    type: p.type || "traditional",
    statement: p.statement || "",
    sample_in: p.sample_in || "",
    sample_out: p.sample_out || "",
    sample_note: p.sample_note || "",
    choice,
    full_score: Number(p.full_score) || 100,
    published: p.published ? 1 : 0,
    review_note: p.review_note || "",
    solution_code: p.solution_code || "",
    testcases: (testcases || []).map((t) => ({
      seq: Number(t.seq),
      score: Number(t.score) || 0,
      is_sample: t.is_sample ? 1 : 0,
      input: String(t.input ?? ""),
      output: String(t.output ?? ""),
    })),
  };
}

export function writeProblemCatalog(doc) {
  ensureCatalogDir();
  const code = doc.code;
  if (!code) throw new Error("catalog 缺少 code");
  const fp = catalogPathForCode(code);
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  fs.writeFileSync(fp, body, "utf8");
  return fp;
}

export function exportProblemToCatalog(db, problemId) {
  const p = db.prepare("SELECT * FROM problems WHERE id = ?").get(problemId);
  if (!p) throw new Error("题目不存在");
  const cases = loadTestcasesWithContent(db, problemId);
  const doc = problemToCatalogDoc(p, cases);
  const fp = writeProblemCatalog(doc);
  return { path: fp, code: p.code };
}

export function writeTestcaseFiles(problemId, testcases) {
  const dir = path.join(PROBLEM_DATA_DIR, String(problemId));
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, name));
  }
  const rows = [];
  for (const t of testcases || []) {
    const seq = Number(t.seq);
    if (!Number.isFinite(seq) || seq <= 0) continue;
    const inRel = `${seq}.in`;
    const outRel = `${seq}.out`;
    fs.writeFileSync(path.join(dir, inRel), String(t.input ?? ""), "utf8");
    fs.writeFileSync(path.join(dir, outRel), String(t.output ?? ""), "utf8");
    rows.push({
      seq,
      score: Number(t.score) || 0,
      is_sample: t.is_sample ? 1 : 0,
      input_rel: inRel,
      output_rel: outRel,
    });
  }
  return rows;
}

export function replaceProblemTestcases(db, problemId, testcases) {
  db.prepare("DELETE FROM testcases WHERE problem_id = ?").run(problemId);
  const rows = writeTestcaseFiles(problemId, testcases);
  const ins = db.prepare(
    `INSERT INTO testcases (problem_id, seq, score, is_sample, input_rel, output_rel) VALUES (?,?,?,?,?,?)`,
  );
  for (const r of rows) {
    ins.run(problemId, r.seq, r.score, r.is_sample, r.input_rel, r.output_rel);
  }
  return rows.length;
}

function normalizeBody(body) {
  const languages = Array.isArray(body.languages)
    ? body.languages
    : typeof body.languages === "string"
      ? (() => {
          try {
            return JSON.parse(body.languages);
          } catch {
            return [];
          }
        })()
      : [];
  let choiceJson = null;
  if (body.choice != null) {
    choiceJson = JSON.stringify(body.choice);
  } else if (body.choice_json != null) {
    choiceJson = typeof body.choice_json === "string" ? body.choice_json : JSON.stringify(body.choice_json);
  }
  return {
    code: String(body.code || "").trim(),
    title: String(body.title || "").trim(),
    source: String(body.source || "").trim(),
    difficulty: String(body.difficulty || "").trim(),
    time_ms: Number(body.time_ms) || 0,
    memory_mb: Number(body.memory_mb) || 0,
    io_mode: String(body.io_mode || "stdin"),
    languages: JSON.stringify(languages),
    type: body.type === "choice" ? "choice" : "traditional",
    statement: String(body.statement ?? ""),
    sample_in: String(body.sample_in ?? ""),
    sample_out: String(body.sample_out ?? ""),
    sample_note: String(body.sample_note ?? ""),
    choice_json: choiceJson,
    full_score: Number(body.full_score) || 100,
    published: body.published ? 1 : 0,
    review_note: String(body.review_note ?? ""),
    solution_code: String(body.solution_code ?? ""),
    testcases: Array.isArray(body.testcases) ? body.testcases : [],
  };
}

/** Update DB + runtime cases + catalog file. Returns updated problem id. */
export function saveProblemFromBody(db, problemId, body) {
  const cur = db.prepare("SELECT * FROM problems WHERE id = ?").get(problemId);
  if (!cur) throw new Error("题目不存在");
  const n = normalizeBody(body);
  if (!n.code) throw new Error("题号不能为空");
  if (!n.title) throw new Error("标题不能为空");
  if (!n.source) throw new Error("来源不能为空");
  if (!n.difficulty) throw new Error("难度不能为空");

  const clash = db.prepare("SELECT id FROM problems WHERE code = ? AND id != ?").get(n.code, problemId);
  if (clash) throw new Error(`题号已被占用：${n.code}`);

  const oldPath = catalogPathForCode(cur.code);
  db.prepare(
    `UPDATE problems SET
      code=?, title=?, source=?, difficulty=?, time_ms=?, memory_mb=?, io_mode=?,
      languages=?, type=?, statement=?, sample_in=?, sample_out=?, sample_note=?,
      choice_json=?, full_score=?, published=?, review_note=?, solution_code=?
     WHERE id=?`,
  ).run(
    n.code,
    n.title,
    n.source,
    n.difficulty,
    n.time_ms,
    n.memory_mb,
    n.io_mode,
    n.languages,
    n.type,
    n.statement,
    n.sample_in,
    n.sample_out,
    n.sample_note,
    n.choice_json,
    n.full_score,
    n.published,
    n.review_note,
    n.solution_code,
    problemId,
  );

  replaceProblemTestcases(db, problemId, n.testcases);

  if (cur.code !== n.code && fs.existsSync(oldPath) && safeCodeFilename(cur.code) !== safeCodeFilename(n.code)) {
    try {
      fs.unlinkSync(oldPath);
    } catch {
      /* ignore */
    }
  }

  const saved = db.prepare("SELECT * FROM problems WHERE id = ?").get(problemId);
  const cases = loadTestcasesWithContent(db, problemId);
  const doc = problemToCatalogDoc(saved, cases);
  const fp = writeProblemCatalog(doc);
  return { problem: saved, catalog_path: fp };
}

export function applyCatalogDoc(db, doc) {
  if (!doc?.code) throw new Error("catalog 缺少 code");
  const n = normalizeBody(doc);
  const existing = db.prepare("SELECT id FROM problems WHERE code = ?").get(n.code);
  let pid;
  if (existing) {
    pid = existing.id;
    db.prepare(
      `UPDATE problems SET
        title=?, source=?, difficulty=?, time_ms=?, memory_mb=?, io_mode=?,
        languages=?, type=?, statement=?, sample_in=?, sample_out=?, sample_note=?,
        choice_json=?, full_score=?, published=?, review_note=?, solution_code=?
       WHERE id=?`,
    ).run(
      n.title,
      n.source,
      n.difficulty,
      n.time_ms,
      n.memory_mb,
      n.io_mode,
      n.languages,
      n.type,
      n.statement,
      n.sample_in,
      n.sample_out,
      n.sample_note,
      n.choice_json,
      n.full_score,
      n.published,
      n.review_note,
      n.solution_code,
      pid,
    );
  } else {
    const info = db
      .prepare(
        `INSERT INTO problems (
          code, title, source, difficulty, time_ms, memory_mb, io_mode,
          languages, type, statement, sample_in, sample_out, sample_note,
          choice_json, full_score, published, review_note, solution_code
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        n.code,
        n.title,
        n.source,
        n.difficulty,
        n.time_ms,
        n.memory_mb,
        n.io_mode,
        n.languages,
        n.type,
        n.statement,
        n.sample_in,
        n.sample_out,
        n.sample_note,
        n.choice_json,
        n.full_score,
        n.published,
        n.review_note,
        n.solution_code,
      );
    pid = Number(info.lastInsertRowid);
  }
  replaceProblemTestcases(db, pid, n.testcases);
  return pid;
}

export function listCatalogFiles() {
  ensureCatalogDir();
  return fs
    .readdirSync(CATALOG_DIR)
    .filter((n) => n.endsWith(".json"))
    .map((n) => path.join(CATALOG_DIR, n))
    .sort();
}

export function applyCatalog(db) {
  const files = listCatalogFiles();
  let ok = 0;
  const errors = [];
  for (const fp of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(fp, "utf8"));
      applyCatalogDoc(db, doc);
      ok += 1;
    } catch (e) {
      errors.push(`${path.basename(fp)}: ${e.message}`);
    }
  }
  return { applied: ok, total: files.length, errors };
}

export function updateCatalogPublished(code, published) {
  const fp = catalogPathForCode(code);
  if (!fs.existsSync(fp)) return null;
  const doc = JSON.parse(fs.readFileSync(fp, "utf8"));
  doc.published = published ? 1 : 0;
  writeProblemCatalog(doc);
  return fp;
}
