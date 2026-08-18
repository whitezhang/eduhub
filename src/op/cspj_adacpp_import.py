#!/usr/bin/env python3
"""Crawl AdaCpp CSP-J practice sets into seed/csp-j and import into EduHub SQLite.

Questions (stem + options) are public in SSR HTML.
Correct answers require a logged-in AdaCpp session — pass --answers JSON
produced by scrape-adacpp-cspj.mjs after login, or leave blank (缺答案).

Source page: https://adacpp.com/practice (cspj-* sets only).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("DATA_DIR") or ROOT / "src" / "rd" / "server" / "data")
RUNTIME = DATA / "runtime"
SEED = DATA / "seed" / "csp-j"
CACHE = DATA / "cache" / "adacpp"
INDEX = "https://adacpp.com/practice"
UA = "EduHub/1.0 (local CSP-J training mirror; educational use)"


def db_path() -> Path:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    env = os.environ.get("EDUHUB_DB")
    if env:
        return Path(env)
    if (RUNTIME / "eduhub.db").exists():
        return RUNTIME / "eduhub.db"
    if (DATA / "eduhub.db").exists():
        return DATA / "eduhub.db"
    return RUNTIME / "eduhub.db"


def fetch(url: str, delay: float = 0.4) -> str:
    time.sleep(delay)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def list_cspj_urls(html: str) -> list[str]:
    urls = sorted(set(re.findall(r"https://adacpp\.com/practice/(cspj-[a-z0-9-]+)", html)))
    return [f"https://adacpp.com/practice/{slug}" for slug in (u.split("/")[-1] for u in urls)]


def extract_questions(html: str) -> list[dict]:
    key = 'initialQuestions\\":['
    pos = html.find(key)
    if pos < 0:
        key = 'initialQuestions":['
        pos = html.find(key)
        if pos < 0:
            return []
    abs_i = pos + len(key) - 1
    k = abs_i
    depth = 0
    in_str = False
    while k < len(html):
        if not in_str:
            if html.startswith('\\"', k):
                in_str = True
                k += 2
                continue
            if html[k] == "[":
                depth += 1
            elif html[k] == "]":
                depth -= 1
                if depth == 0:
                    k += 1
                    break
            k += 1
        else:
            if html.startswith("\\\\", k):
                k += 2
                continue
            if html.startswith('\\"', k):
                in_str = False
                k += 2
                continue
            k += 1
    raw_esc = html[abs_i:k]
    parts: list[str] = []
    p = 0
    while p < len(raw_esc):
        if raw_esc.startswith('\\"', p):
            parts.append('"')
            p += 2
        elif raw_esc.startswith("\\\\", p):
            parts.append("\\")
            p += 2
        else:
            parts.append(raw_esc[p])
            p += 1
    data = json.loads("".join(parts))
    out = []
    for q in data:
        opts = q.get("options")
        if isinstance(opts, str):
            opts = json.loads(opts)
        out.append(
            {
                "id": q.get("id"),
                "type": q.get("type") or "single_choice",
                "content": q.get("content") or "",
                "options": opts or [],
                "answer": None,
                "explanation": None,
            }
        )
    return out


def page_title(html: str, slug: str) -> str:
    m = re.search(r"<title>([^<]+)</title>", html)
    if m:
        t = re.sub(r"\s*\|.*$", "", m.group(1)).strip()
        t = t.replace(" - 在线刷题与解析", "").replace("在线刷题与解析", "").strip()
        if t:
            return t
    return slug


def crawl(skip_existing: bool = True) -> list[dict]:
    SEED.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    index_html = fetch(INDEX, delay=0.2)
    (CACHE / "practice.html").write_text(index_html, encoding="utf-8")
    urls = list_cspj_urls(index_html)
    print(f"found {len(urls)} cspj sets", flush=True)
    papers = []
    for url in urls:
        slug = url.rsplit("/", 1)[-1]
        out = SEED / f"{slug}.json"
        if skip_existing and out.exists():
            data = json.loads(out.read_text(encoding="utf-8"))
            papers.append(data)
            print(f"skip existing {slug} ({len(data.get('questions') or [])} q)", flush=True)
            continue
        print(f"fetch {slug}", flush=True)
        html = fetch(url)
        (CACHE / f"{slug}.html").write_text(html, encoding="utf-8")
        qs = extract_questions(html)
        data = {
            "slug": slug,
            "url": url,
            "title": page_title(html, slug),
            "source": "csp-j",
            "origin": "adacpp.com/practice",
            "questions": qs,
        }
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        papers.append(data)
        print(f"  -> {len(qs)} questions", flush=True)
    (SEED / "_index.json").write_text(
        json.dumps(
            [{"slug": p["slug"], "title": p["title"], "questions": len(p["questions"])} for p in papers],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return papers


def merge_answers(papers: list[dict], answers_path: Path | None) -> None:
    if not answers_path or not answers_path.exists():
        return
    blob = json.loads(answers_path.read_text(encoding="utf-8"))
    # map questionId -> {answer, explanation}
    by_id: dict[str, dict] = {}
    if isinstance(blob, dict) and "byId" in blob:
        by_id = blob["byId"]
    elif isinstance(blob, list):
        for item in blob:
            for q in item.get("questions") or []:
                if q.get("id") and q.get("answer"):
                    by_id[q["id"]] = {"answer": q["answer"], "explanation": q.get("explanation")}
    elif isinstance(blob, dict):
        by_id = blob
    n = 0
    for p in papers:
        changed = False
        for q in p["questions"]:
            hit = by_id.get(q["id"])
            if not hit:
                continue
            ans = hit.get("answer") or hit.get("correctAnswer")
            if ans:
                q["answer"] = str(ans).strip()
                q["explanation"] = hit.get("explanation")
                n += 1
                changed = True
        if changed:
            (SEED / f"{p['slug']}.json").write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"merged answers for {n} questions", flush=True)


def normalize_answer(ans: str | None, qtype: str, options: list) -> str:
    if not ans:
        return ""
    a = str(ans).strip()
    if qtype in ("true_false", "tf", "judge"):
        if a in ("对", "正确", "T", "true", "True", "√"):
            return "对"
        if a in ("错", "错误", "F", "false", "False", "×"):
            return "错"
    # map label
    if re.fullmatch(r"[A-Da-d]", a):
        return a.upper()
    for opt in options or []:
        label = opt.get("label") or opt.get("key")
        text = str(opt.get("text") or "")
        if a == text or a == f"{label}. {text}":
            return str(label).upper()
    return a


def choice_options_for_db(q: dict) -> list[dict]:
    opts = q.get("options") or []
    qtype = q.get("type") or ""
    if qtype in ("true_false", "tf") or (len(opts) == 2 and all(str(o.get("text", "")) in ("对", "错", "正确", "错误") for o in opts)):
        # EduHub tf often uses 对/错
        mapped = []
        for o in opts:
            label = o.get("label")
            text = str(o.get("text") or "")
            mapped.append({"key": label or text, "text": text})
        return mapped
    out = []
    for o in opts:
        label = str(o.get("label") or "").upper()
        text = str(o.get("text") or "")
        out.append({"key": label, "text": text})
    return out


def upsert_problem(con: sqlite3.Connection, row: dict) -> int | None:
    existing = con.execute("SELECT id, published FROM problems WHERE code = ?", (row["code"],)).fetchone()
    if existing and existing[1] == 1:
        # refresh content for csp-j imports
        con.execute(
            """UPDATE problems SET title=?, source=?, difficulty=?, time_ms=?, memory_mb=?,
               languages=?, type=?, statement=?, sample_in=?, sample_out=?, sample_note=?,
               choice_json=?, full_score=?, published=1, review_note=? WHERE id=?""",
            (
                row["title"],
                row["source"],
                row["difficulty"],
                row["time_ms"],
                row["memory_mb"],
                row["languages"],
                row["type"],
                row["statement"],
                row["sample_in"],
                row["sample_out"],
                row["sample_note"],
                row["choice_json"],
                row["full_score"],
                row["review_note"],
                existing[0],
            ),
        )
        return existing[0]
    if existing:
        con.execute(
            """UPDATE problems SET title=?, source=?, difficulty=?, time_ms=?, memory_mb=?,
               languages=?, type=?, statement=?, sample_in=?, sample_out=?, sample_note=?,
               choice_json=?, full_score=?, published=1, review_note=? WHERE id=?""",
            (
                row["title"],
                row["source"],
                row["difficulty"],
                row["time_ms"],
                row["memory_mb"],
                row["languages"],
                row["type"],
                row["statement"],
                row["sample_in"],
                row["sample_out"],
                row["sample_note"],
                row["choice_json"],
                row["full_score"],
                row["review_note"],
                existing[0],
            ),
        )
        return existing[0]
    cur = con.execute(
        """INSERT INTO problems (code, title, source, difficulty, time_ms, memory_mb, io_mode,
           languages, type, statement, sample_in, sample_out, sample_note, choice_json, full_score,
           published, review_note)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)""",
        (
            row["code"],
            row["title"],
            row["source"],
            row["difficulty"],
            row["time_ms"],
            row["memory_mb"],
            "stdin",
            row["languages"],
            row["type"],
            row["statement"],
            row["sample_in"],
            row["sample_out"],
            row["sample_note"],
            row["choice_json"],
            row["full_score"],
            row["review_note"],
        ),
    )
    return cur.lastrowid


def import_papers(papers: list[dict]) -> None:
    path = db_path()
    con = sqlite3.connect(path)
    try:
        list_row = con.execute("SELECT id FROM problem_lists WHERE slug='csp-j'").fetchone()
        list_id = list_row[0] if list_row else None
        max_seq = 0
        if list_id:
            max_seq = con.execute(
                "SELECT COALESCE(MAX(seq),0) FROM problem_list_items WHERE list_id=?",
                (list_id,),
            ).fetchone()[0]

        def add_list(pid: int):
            nonlocal max_seq
            if not list_id:
                return
            if con.execute(
                "SELECT 1 FROM problem_list_items WHERE list_id=? AND problem_id=?",
                (list_id, pid),
            ).fetchone():
                return
            max_seq += 1
            con.execute(
                "INSERT INTO problem_list_items (list_id, problem_id, seq) VALUES (?,?,?)",
                (list_id, pid, max_seq),
            )

        total_q = 0
        total_ans = 0
        for paper in papers:
            slug = paper["slug"]
            title = paper.get("title") or slug
            pids = []
            for i, q in enumerate(paper.get("questions") or [], 1):
                opts = choice_options_for_db(q)
                qtype = q.get("type") or "single_choice"
                is_tf = qtype in ("true_false", "tf") or (
                    len(opts) == 2
                    and {str(o.get("text")) for o in opts} <= {"对", "错", "正确", "错误", "True", "False"}
                )
                ans = normalize_answer(q.get("answer"), "tf" if is_tf else "choice", opts)
                flags = []
                if not ans:
                    flags.append("缺答案")
                code = f"CSPJ-{slug.upper().replace('CSPJ-', '')}-{i:02d}"
                # shorten code
                code = f"CSPJ-{slug}-{i:02d}"
                if len(code) > 64:
                    code = f"CSPJ-{abs(hash(slug)) % 10_000_000:07d}-{i:02d}"
                stmt = q.get("content") or ""
                choice = {"options": opts, "answer": ans}
                if q.get("explanation"):
                    choice["explanation"] = q["explanation"]
                row = {
                    "code": code,
                    "title": f"CSP-J {title} {i}",
                    "source": "csp-j",
                    "difficulty": "CSP-J",
                    "time_ms": 0,
                    "memory_mb": 0,
                    "languages": "[]",
                    "type": "choice",
                    "statement": stmt,
                    "sample_in": "",
                    "sample_out": "",
                    "sample_note": "",
                    "choice_json": json.dumps(choice, ensure_ascii=False),
                    "full_score": 100,
                    "review_note": "来源：https://adacpp.com/practice 的 CSP-J 练习；第三方整理，请核对后使用。"
                    + ((" 标记：" + "、".join(flags)) if flags else ""),
                }
                pid = upsert_problem(con, row)
                if pid:
                    pids.append(pid)
                    add_list(pid)
                    total_q += 1
                    if ans:
                        total_ans += 1

            if not pids:
                continue
            contest_title = f"CSP-J · {title}"
            ex = con.execute("SELECT id FROM contests WHERE title = ?", (contest_title,)).fetchone()
            if not ex:
                con.execute(
                    "INSERT INTO contests (title, rule, duration_min, start_at, end_at, published) VALUES (?,?,?,?,?,1)",
                    (contest_title, "practice", 120, "2020-01-01T00:00:00.000Z", "2099-12-31T00:00:00.000Z"),
                )
                cid = con.execute("SELECT last_insert_rowid()").fetchone()[0]
            else:
                cid = ex[0]
                con.execute("DELETE FROM contest_problems WHERE contest_id=?", (cid,))
            for seq, pid in enumerate(pids, 1):
                con.execute(
                    "INSERT INTO contest_problems (contest_id, problem_id, seq) VALUES (?,?,?)",
                    (cid, pid, seq),
                )
            print(f"import paper {contest_title}: {len(pids)} problems", flush=True)

        con.commit()
        print(f"done: {total_q} problems, {total_ans} with answers, db={path}", flush=True)
    finally:
        con.close()


def load_seed() -> list[dict]:
    papers = []
    for p in sorted(SEED.glob("cspj-*.json")):
        papers.append(json.loads(p.read_text(encoding="utf-8")))
    return papers


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-crawl", action="store_true")
    ap.add_argument("--no-import", action="store_true")
    ap.add_argument("--force-crawl", action="store_true")
    ap.add_argument("--answers", type=Path, help="JSON map of questionId -> answer from logged-in scrape")
    args = ap.parse_args()

    if args.skip_crawl:
        papers = load_seed()
        if not papers:
            print("no seed json; run without --skip-crawl first", flush=True)
            sys.exit(1)
    else:
        papers = crawl(skip_existing=not args.force_crawl)

    merge_answers(papers, args.answers)

    if not args.no_import:
        import_papers(papers)


if __name__ == "__main__":
    main()
