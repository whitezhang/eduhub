#!/usr/bin/env python3
"""Import AdaCpp GESP exam practice (seed/gesp-adacpp) into EduHub and backfill answers.

Maps slugs like gesp-cpp-1ji-202606 → codes GESP-202606-CPP1-C01 / -J01
so existing PDF-imported choice/TF get answers filled in.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[2]
_OP = Path(__file__).resolve().parent
if str(_OP) not in sys.path:
    sys.path.insert(0, str(_OP))
from eduhub_paths import data_dir as DATA, db_path, migrate_legacy_runtime, runtime_dir as RUNTIME

SEED = DATA / "seed" / "gesp-adacpp"
GESP_PDF_SEED = DATA / "seed" / "gesp"


def resolve_db_path() -> Path:
    migrate_legacy_runtime()
    return db_path()


def load_papers() -> list[dict]:
    papers = []
    for p in sorted(SEED.glob("gesp-*.json")):
        papers.append(json.loads(p.read_text(encoding="utf-8")))
    return papers


def load_pdf_answers() -> dict[str, str]:
    """GESP code → answer key from PDF seed (试题节首答案表)."""
    out: dict[str, str] = {}
    tf_norm = {"T": "T", "F": "F", "对": "T", "错": "F", "√": "T", "✓": "T", "×": "F", "✗": "F"}
    for path in sorted(GESP_PDF_SEED.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        meta = data.get("meta") or {}
        ym, lang, level = meta.get("ym"), meta.get("lang"), meta.get("level")
        if not ym or not lang or not level:
            continue
        level = int(level)
        for q in data.get("choice") or []:
            a = str(q.get("answer") or "").strip().upper()
            if re.fullmatch(r"[A-D]", a):
                out[problem_code(ym, lang, level, "choice", int(q["seq"]))] = a
        for q in data.get("tf") or []:
            a = tf_norm.get(str(q.get("answer") or "").strip(), str(q.get("answer") or "").strip())
            if a in ("T", "F"):
                out[problem_code(ym, lang, level, "tf", int(q["seq"]))] = a
    return out


def backfill_pdf_answers(con: sqlite3.Connection, pdf_answers: dict[str, str]) -> int:
    filled = 0
    for code, ans in pdf_answers.items():
        row = con.execute("SELECT id, choice_json FROM problems WHERE code=?", (code,)).fetchone()
        if not row:
            continue
        try:
            cj = json.loads(row[1] or "{}")
        except Exception:
            cj = {}
        if str(cj.get("answer") or "").strip():
            continue
        cj["answer"] = ans
        con.execute(
            "UPDATE problems SET choice_json=? WHERE id=?",
            (json.dumps(cj, ensure_ascii=False), row[0]),
        )
        filled += 1
    return filled


def normalize_answer(ans: str | None, is_tf: bool) -> str:
    if not ans:
        return ""
    a = str(ans).strip()
    if is_tf:
        if a in ("对", "正确", "T", "true", "True", "√", "A"):
            # AdaCpp sometimes uses A/B for 对/错 — handled below via options
            if a == "A":
                return "A"
            return "对"
        if a in ("错", "错误", "F", "false", "False", "×", "B"):
            if a == "B":
                return "B"
            return "错"
    if re.fullmatch(r"[A-Da-d]", a):
        return a.upper()
    return a


def is_tf_question(q: dict) -> bool:
    qtype = q.get("type") or ""
    if qtype in ("true_false", "tf"):
        return True
    opts = q.get("options") or []
    texts = {str(o.get("text") or "") for o in opts}
    return len(opts) == 2 and texts <= {"对", "错", "正确", "错误", "True", "False"}


def options_for_db(q: dict) -> list[dict]:
    out = []
    for o in q.get("options") or []:
        label = str(o.get("label") or "").upper()
        text = str(o.get("text") or "")
        out.append({"key": label or text, "text": text})
    return out


def map_answer_to_key(ans: str, opts: list[dict], is_tf: bool) -> str:
    a = normalize_answer(ans, is_tf)
    if not a:
        return ""
    if re.fullmatch(r"[A-D]", a):
        return a
    # match by option text
    for o in opts:
        if a == o.get("text") or a == o.get("key"):
            return str(o.get("key") or "").upper() or a
    if is_tf:
        if a in ("对", "正确"):
            for o in opts:
                if o.get("text") in ("对", "正确"):
                    return str(o.get("key") or "A")
            return "对"
        if a in ("错", "错误"):
            for o in opts:
                if o.get("text") in ("错", "错误"):
                    return str(o.get("key") or "B")
            return "错"
    return a


def split_choice_tf(questions: list[dict]) -> tuple[list[dict], list[dict]]:
    """Prefer type; else first block of 4-option then 2-option."""
    typed_c = [q for q in questions if (q.get("type") or "") == "single_choice" and not is_tf_question(q)]
    typed_t = [q for q in questions if is_tf_question(q)]
    if typed_c or typed_t:
        # keep order within each
        return typed_c or [q for q in questions if not is_tf_question(q)], typed_t or [
            q for q in questions if is_tf_question(q)
        ]
    choices, tfs = [], []
    for q in questions:
        opts = q.get("options") or []
        if len(opts) <= 2:
            tfs.append(q)
        else:
            choices.append(q)
    return choices, tfs


def lang_tag(lang: str) -> str:
    return "CPP" if lang == "cpp" else "PY"


def problem_code(ym: str, lang: str, level: int, kind: str, seq: int) -> str:
    tag = {"choice": "C", "tf": "J"}[kind]
    return f"GESP-{ym}-{lang_tag(lang)}{level}-{tag}{seq:02d}"


def contest_title(ym: str, lang: str, level: int) -> str:
    y, m = ym[:4], int(ym[4:] or 0)
    lab = "C++" if lang == "cpp" else "Python"
    return f"GESP {y}年{m}月 {lab} {level}级"


def upsert_choice(con: sqlite3.Connection, row: dict) -> tuple[int | None, bool]:
    """Returns (pid, answer_written). Always refresh choice answer when provided."""
    existing = con.execute(
        "SELECT id, choice_json, published FROM problems WHERE code = ?",
        (row["code"],),
    ).fetchone()
    wrote_ans = bool(json.loads(row["choice_json"]).get("answer"))
    if existing:
        pid = existing[0]
        # merge: keep existing statement if new empty; always update answer when present
        old = {}
        try:
            old = json.loads(existing[1] or "{}")
        except Exception:
            old = {}
        newc = json.loads(row["choice_json"])
        if not newc.get("options") and old.get("options"):
            newc["options"] = old["options"]
        if not newc.get("answer") and old.get("answer"):
            newc["answer"] = old["answer"]
        choice_json = json.dumps(newc, ensure_ascii=False)
        stmt = row["statement"] or ""
        if not stmt:
            prev = con.execute("SELECT statement FROM problems WHERE id=?", (pid,)).fetchone()
            stmt = prev[0] if prev else ""
        con.execute(
            """UPDATE problems SET title=?, source='gesp', difficulty=?, type='choice',
               statement=?, choice_json=?, full_score=100, published=1, review_note=?
               WHERE id=?""",
            (
                row["title"],
                row["difficulty"],
                stmt,
                choice_json,
                row["review_note"],
                pid,
            ),
        )
        return pid, bool(newc.get("answer"))
    cur = con.execute(
        """INSERT INTO problems (code, title, source, difficulty, time_ms, memory_mb, io_mode,
           languages, type, statement, sample_in, sample_out, sample_note, choice_json, full_score,
           published, review_note)
           VALUES (?,?,?,?,0,0,'stdin','[]','choice',?,?,?,?,?,100,1,?)""",
        (
            row["code"],
            row["title"],
            "gesp",
            row["difficulty"],
            row["statement"],
            "",
            "",
            "",
            row["choice_json"],
            row["review_note"],
        ),
    )
    return cur.lastrowid, wrote_ans


def ensure_contest(con: sqlite3.Connection, title: str, pids: list[int]) -> None:
    if not pids:
        return
    ex = con.execute("SELECT id FROM contests WHERE title = ?", (title,)).fetchone()
    if not ex:
        con.execute(
            "INSERT INTO contests (title, rule, duration_min, start_at, end_at, published) VALUES (?,?,?,?,?,1)",
            (title, "practice", 120, "2020-01-01T00:00:00.000Z", "2099-12-31T00:00:00.000Z"),
        )
        cid = con.execute("SELECT last_insert_rowid()").fetchone()[0]
    else:
        cid = ex[0]
    # merge: keep programming rows, replace/add choice/tf by seq from AdaCpp codes
    existing = {
        r[0]: r[1]
        for r in con.execute(
            "SELECT problem_id, seq FROM contest_problems WHERE contest_id=?",
            (cid,),
        ).fetchall()
    }
    # remove contest links for codes we're about to re-add (same problem ids)
    for seq, pid in enumerate(pids, 1):
        con.execute(
            "DELETE FROM contest_problems WHERE contest_id=? AND problem_id=?",
            (cid, pid),
        )
        con.execute(
            "INSERT INTO contest_problems (contest_id, problem_id, seq) VALUES (?,?,?)",
            (cid, pid, seq),
        )
        # if old seq occupied by another problem that's programming, bump — keep simple: use AdaCpp order for objective only
        # Actually better: put AdaCpp choice/tf at their seq, leave traditional at high seq
    # Re-seq: choice/tf first by AdaCpp order, then remaining traditional
    all_pids = []
    seen = set()
    for pid in pids:
        all_pids.append(pid)
        seen.add(pid)
    for pid, _seq in sorted(existing.items(), key=lambda x: x[1]):
        if pid in seen:
            continue
        ptype = con.execute("SELECT type FROM problems WHERE id=?", (pid,)).fetchone()
        if ptype and ptype[0] == "traditional":
            all_pids.append(pid)
            seen.add(pid)
    con.execute("DELETE FROM contest_problems WHERE contest_id=?", (cid,))
    for seq, pid in enumerate(all_pids, 1):
        con.execute(
            "INSERT INTO contest_problems (contest_id, problem_id, seq) VALUES (?,?,?)",
            (cid, pid, seq),
        )


def add_to_gesp_list(con: sqlite3.Connection, pid: int) -> None:
    row = con.execute("SELECT id FROM problem_lists WHERE slug='gesp'").fetchone()
    if not row:
        return
    list_id = row[0]
    if con.execute(
        "SELECT 1 FROM problem_list_items WHERE list_id=? AND problem_id=?",
        (list_id, pid),
    ).fetchone():
        return
    mx = con.execute(
        "SELECT COALESCE(MAX(seq),0) FROM problem_list_items WHERE list_id=?",
        (list_id,),
    ).fetchone()[0]
    con.execute(
        "INSERT INTO problem_list_items (list_id, problem_id, seq) VALUES (?,?,?)",
        (list_id, pid, mx + 1),
    )


def import_papers(papers: list[dict]) -> None:
    path = resolve_db_path()
    con = sqlite3.connect(path)
    total = 0
    with_ans = 0
    filled_existing = 0
    pdf_answers = load_pdf_answers()
    try:
        con.execute(
            "UPDATE problem_lists SET blurb=? WHERE slug='gesp'",
            ("GESP 客观题：AdaCpp 题面 + PDF/AdaCpp 合并答案；编程来自 CCF 官方 PDF",),
        )
        for paper in papers:
            meta = paper.get("meta") or {}
            if not meta:
                m = re.match(r"^gesp-(cpp|python)-(\d+)ji-(\d{6})$", paper.get("slug") or "", re.I)
                if not m:
                    print(f"skip bad slug {paper.get('slug')}", flush=True)
                    continue
                meta = {"lang": m.group(1).lower(), "level": int(m.group(2)), "ym": m.group(3)}
            ym, lang, level = meta["ym"], meta["lang"], int(meta["level"])
            choices, tfs = split_choice_tf(paper.get("questions") or [])
            pids: list[int] = []
            note = "来源：AdaCpp 题面 + PDF 试题节首答案表/AdaCpp 答案合并。"

            def add_q(q: dict, kind: str, seq: int) -> None:
                nonlocal total, with_ans, filled_existing
                opts = options_for_db(q)
                is_tf = kind == "tf"
                ans = map_answer_to_key(q.get("answer") or "", opts, is_tf)
                code = problem_code(ym, lang, level, kind, seq)
                if not ans:
                    pdf_a = pdf_answers.get(code, "")
                    if pdf_a:
                        ans = pdf_a if is_tf else map_answer_to_key(pdf_a, opts, is_tf)
                title = f"GESP {level}级 {'C++' if lang == 'cpp' else 'Python'} {'判断' if is_tf else '选择'} {seq}"
                choice = {"options": opts, "answer": ans}
                if q.get("explanation"):
                    choice["explanation"] = q["explanation"]
                existed = con.execute("SELECT id FROM problems WHERE code=?", (code,)).fetchone()
                row = {
                    "code": code,
                    "title": title,
                    "difficulty": f"GESP {level}级",
                    "statement": q.get("content") or "",
                    "choice_json": json.dumps(choice, ensure_ascii=False),
                    "review_note": note + ("" if ans else " 标记：缺答案"),
                }
                pid, ok = upsert_choice(con, row)
                if pid:
                    pids.append(pid)
                    add_to_gesp_list(con, pid)
                    total += 1
                    if ok:
                        with_ans += 1
                    if existed and ok:
                        filled_existing += 1

            for i, q in enumerate(choices, 1):
                add_q(q, "choice", i)
            for i, q in enumerate(tfs, 1):
                add_q(q, "tf", i)

            title = contest_title(ym, lang, level)
            ensure_contest(con, title, pids)
            print(
                f"import {title}: choice={len(choices)} tf={len(tfs)} linked={len(pids)}",
                flush=True,
            )

        con.commit()
        # Mirror C++ objective answers onto matching Python codes when Python still blank
        py_rows = con.execute(
            "SELECT id, code, choice_json FROM problems WHERE source='gesp' AND type='choice' AND code LIKE 'GESP-%-PY%'"
        ).fetchall()
        mirrored = 0
        for pid, code, cj in py_rows:
            try:
                ans = json.loads(cj or "{}").get("answer")
            except Exception:
                ans = ""
            if str(ans or "").strip():
                continue
            m = re.match(r"GESP-(\d+)-PY(\d+)-([CJ])(\d+)", code)
            if not m:
                continue
            ym, lv, k, seq = m.groups()
            cpp = f"GESP-{ym}-CPP{lv}-{k}{seq}"
            r = con.execute("SELECT choice_json FROM problems WHERE code=?", (cpp,)).fetchone()
            if not r:
                continue
            try:
                src = json.loads(r[0] or "{}")
            except Exception:
                continue
            a = src.get("answer")
            if not a:
                continue
            try:
                dst = json.loads(cj or "{}")
            except Exception:
                dst = {}
            dst["answer"] = a
            if src.get("explanation") and not dst.get("explanation"):
                dst["explanation"] = src["explanation"]
            con.execute(
                "UPDATE problems SET choice_json=? WHERE id=?",
                (json.dumps(dst, ensure_ascii=False), pid),
            )
            mirrored += 1
        pdf_filled = backfill_pdf_answers(con, pdf_answers)
        con.commit()
        print(
            f"done: problems touched={total}, with_answer={with_ans}, "
            f"filled_existing={filled_existing}, mirrored_py={mirrored}, "
            f"pdf_backfill={pdf_filled}, db={path}",
            flush=True,
        )
    finally:
        con.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-import", action="store_true")
    args = ap.parse_args()
    papers = load_papers()
    if not papers:
        print(f"no seed in {SEED}; run: node src/op/scrape-adacpp-gesp.mjs", flush=True)
        sys.exit(1)
    print(f"loaded {len(papers)} papers from {SEED}", flush=True)
    if not args.no_import:
        import_papers(papers)


if __name__ == "__main__":
    main()
