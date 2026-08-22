#!/usr/bin/env python3
"""Crawl official CCF GESP 真题 PDFs and import programming problems into EduHub.

Choice / judgment use AdaCpp (gesp_adacpp_import.py). This script only writes
traditional (programming) problems from PDF; full parse still lands in seed/gesp/.
Source: https://gesp.ccf.org.cn/101/1010/ only. Skips 图形化. Requires CCF authorization.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.parse
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
CACHE_GESP = DATA / "cache" / "gesp"
PARSED_DIR = DATA / "seed" / "gesp"


def apply_tf_vision(parsed: dict, pdf_path: Path, *, prefer_vision: bool = False) -> int:
    """Fill judgment answers from PDF graphics / local vision (import-only)."""
    op_dir = Path(__file__).resolve().parent
    if str(op_dir) not in sys.path:
        sys.path.insert(0, str(op_dir))
    from gesp_tf_vision import enrich_parsed_tf

    return enrich_parsed_tf(parsed, pdf_path, prefer_vision=prefer_vision)


def migrate_layout() -> None:
    """Old flat data/ → runtime / cache / seed. Same-volume rename, no copy."""
    RUNTIME.mkdir(parents=True, exist_ok=True)
    CACHE_GESP.mkdir(parents=True, exist_ok=True)
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "tmp").mkdir(parents=True, exist_ok=True)

    def take(src: Path, dest: Path) -> None:
        if not src.exists() or dest.exists():
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            src.rename(dest)
        except PermissionError:
            print(f"skip locked {src}", flush=True)

    take(DATA / "eduhub.db", RUNTIME / "eduhub.db")
    take(DATA / "eduhub.db-wal", RUNTIME / "eduhub.db-wal")
    take(DATA / "eduhub.db-shm", RUNTIME / "eduhub.db-shm")
    take(DATA / "problems", RUNTIME / "problems")
    (RUNTIME / "problems").mkdir(parents=True, exist_ok=True)
    take(DATA / "tmp", RUNTIME / "tmp")
    take(DATA / "crawls", DATA / "cache" / "crawls")
    old = DATA / "imports" / "gesp"
    if old.is_dir():
        parsed = old / "parsed"
        if parsed.is_dir():
            for p in parsed.glob("*.json"):
                take(p, PARSED_DIR / p.name)
        for p in old.glob("*.pdf"):
            take(p, CACHE_GESP / p.name)


migrate_layout()
DB_PATH = Path(
    os.environ.get("EDUHUB_DB")
    or (
        RUNTIME / "eduhub.db"
        if (RUNTIME / "eduhub.db").exists()
        else DATA / "eduhub.db"
        if (DATA / "eduhub.db").exists()
        else RUNTIME / "eduhub.db"
    )
)
PROBLEM_DIR = RUNTIME / "problems" if (RUNTIME / "problems").exists() else DATA / "problems"
BASE = "https://gesp.ccf.org.cn"
INDEX_PAGES = [
    f"{BASE}/101/1010/index.html",
    f"{BASE}/101/1010/index_2.html",
]
UA = "EduHub/1.0 (CCF-authorized local GESP training mirror; +https://gesp.ccf.org.cn/)"

CN_LEVEL = {
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
}


def nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "")


def fetch(url: str, dest: Path | None = None, delay: float = 0.35) -> bytes:
    time.sleep(delay)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if dest:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return data


def abs_url(href: str) -> str:
    return urllib.parse.urljoin(BASE + "/", href)


def session_links() -> list[dict]:
    found: dict[str, dict] = {}
    for page in INDEX_PAGES:
        try:
            html = fetch(page, delay=0.2).decode("utf-8", "replace")
        except Exception as exc:
            print(f"index fail {page}: {exc}", flush=True)
            continue
        for m in re.finditer(
            r'<a href="(/101/1010/\d+\.html)" class="indexNoticeListItem">\s*<main>\s*<div>(.*?)</div>\s*<div>(.*?)</div>',
            html,
            re.S,
        ):
            href, title, date = m.group(1), re.sub(r"\s+", "", m.group(2)), m.group(3).strip()
            ym = None
            mm = re.search(r"(20\d{2})年(\d{1,2})月", nfkc(title))
            if mm:
                ym = f"{mm.group(1)}{int(mm.group(2)):02d}"
            found[href] = {
                "url": abs_url(href),
                "title": nfkc(title),
                "date": date,
                "ym": ym or "000000",
            }
    return sorted(found.values(), key=lambda x: x["ym"], reverse=True)


def classify_pdf(title: str, href: str) -> dict | None:
    t = nfkc(title)
    if re.search(r"图形|Scratch|scratch", t, re.I):
        return None
    lang = None
    if re.search(r"C\+\+|C＋＋|C\s*\+\+", t, re.I):
        lang = "cpp"
    elif re.search(r"Python", t, re.I):
        lang = "python"
    if not lang:
        return None
    kind = "jiexi" if "解析" in t else "shiti"
    level = None
    m = re.search(r"([1-8])\s*级", t)
    if m:
        level = int(m.group(1))
    else:
        m2 = re.search(r"([一二三四五六七八])\s*级", t)
        if m2:
            level = CN_LEVEL[m2.group(1)]
    if not level:
        return None
    return {"lang": lang, "level": level, "kind": kind, "href": abs_url(href), "title": t}


def pdfs_on_session(html: str) -> list[dict]:
    out = []
    seen = set()
    patterns = [
        re.compile(r'<a[^>]*href="([^"]+\.pdf)"[^>]*title="([^"]*)"', re.I),
        re.compile(r'<a[^>]*title="([^"]*)"[^>]*href="([^"]+\.pdf)"', re.I),
    ]
    pairs = []
    for i, pat in enumerate(patterns):
        for m in pat.finditer(html):
            if i == 0:
                pairs.append((m.group(1), m.group(2)))
            else:
                pairs.append((m.group(2), m.group(1)))
    inner = re.compile(r'<a[^>]*href="([^"]+\.pdf)"[^>]*>(.*?)</a>', re.I | re.S)
    for m in inner.finditer(html):
        text = re.sub(r"<[^>]+>", "", m.group(2))
        pairs.append((m.group(1), text.strip()))
    for href, title in pairs:
        info = classify_pdf(title, href)
        if not info:
            continue
        key = (info["lang"], info["level"], info["kind"])
        if key in seen:
            continue
        seen.add(key)
        out.append(info)
    return out


def extract_pdf_text(path: Path) -> str:
    """Extract PDF text with blocks sorted top-to-bottom, left-to-right per page."""

    def normalize(raw: str) -> str:
        text = nfkc(raw)
        text = re.sub(r"\n\s*\d+\s*/\s*\d+\s*\n", "\n", text)
        text = text.replace("\u3000", " ")
        text = re.sub(r"[ \t]+\n", "\n", text)
        return text

    try:
        import pymupdf
    except ImportError:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        parts = [page.extract_text() or "" for page in reader.pages]
        return normalize("\n".join(parts))

    doc = pymupdf.open(str(path))
    page_parts: list[str] = []
    try:
        for page in doc:
            blocks = page.get_text("blocks")
            ordered = sorted(blocks, key=lambda b: (round(b[1], 1), round(b[0], 1)))
            chunks = [b[4].rstrip() for b in ordered if (b[4] or "").strip()]
            page_parts.append("\n".join(chunks))
    finally:
        doc.close()
    return normalize("\n".join(page_parts))


def parse_section_answer_table(section: str, kind: str) -> list[str]:
    """Parse 题号/答案 table at the top of a 单选题 or 判断题 section (before 第 1 题)."""
    m = re.search(r"第\s*1\s*题", section)
    if not m or "答案" not in section[: m.start()]:
        return []
    preamble = section[: m.start()]
    _, after_ans = preamble.split("答案", 1)
    after_ans = after_ans.strip()
    if kind == "choice":
        keys = re.findall(r"[A-D]", after_ans, flags=re.I)
        return [k.upper() for k in keys[:15]]
    tokens: list[str] = []
    for hit in re.finditer(r"[√✓×✗]|对|错|正确|错误|\b[TtFf]\b", after_ans):
        tokens.append(hit.group(0))
    if not tokens:
        return []
    mapped = {"对": "T", "正确": "T", "√": "T", "✓": "T", "T": "T", "t": "T",
              "错": "F", "错误": "F", "×": "F", "✗": "F", "F": "F", "f": "F"}
    return [mapped.get(t, t) for t in tokens[:10]]


def parse_answer_rows(text: str) -> list[list[str]]:
    rows = []
    for m in re.finditer(
        r"题号\s*([0-9 \t]+)\s*答案\s*([A-D对错√×TF正确错误\s]+)",
        text,
    ):
        keys = re.findall(r"[A-D]|对|错|√|×|[TF]|正确|错误", m.group(2))
        if keys:
            rows.append(keys)
    return rows


def split_section(text: str, start_pat: str, end_pats: list[str]) -> str:
    m = re.search(start_pat, text)
    if not m:
        return ""
    start = m.start()
    end = len(text)
    for pat in end_pats:
        n = re.search(pat, text[m.end() :])
        if n:
            end = min(end, m.end() + n.start())
    return text[start:end]


def parse_options(body: str) -> tuple[str, list[dict], str]:
    opts = []
    first = None
    leftover = body
    for key in "ABCD":
        pat = re.compile(rf"(?:^|\n)\s*{key}\.\s*")
        m = pat.search(leftover if first is None else leftover)
        if not m:
            continue
        if first is None:
            first = m.start()
    if first is None:
        return body.strip(), [], ""
    stem = body[:first].strip()
    rest = body[first:]
    chunks = re.split(r"(?:^|\n)\s*([A-D])\.\s*", rest)
    # chunks: preamble, key, text, key, text...
    i = 1
    while i + 1 < len(chunks):
        key = chunks[i]
        raw = chunks[i + 1]
        nxt = re.split(r"\n(?=第\s*\d+\s*题)", raw, maxsplit=1)
        text = nxt[0].strip()
        text = re.sub(r"^\d+\s*$", "", text, flags=re.M).strip()
        opts.append({"key": key, "text": re.sub(r"\s+", " ", text)})
        i += 2
    tail = ""
    if opts:
        last = opts[-1]["text"]
        # keep option text short; dump obvious trailing code into tail
        lines = last.split(" ")
    code_tail = []
    cleaned_opts = []
    for opt in opts:
        parts = re.split(r"(?=\n(?:int |float |double |#include|for |cout |cin |printf|def |print\())", "\n" + opt["text"], maxsplit=1)
        cleaned_opts.append({"key": opt["key"], "text": parts[0].strip()})
        if len(parts) > 1:
            code_tail.append(parts[1].strip())
    # recover code that sat after D
    after = rest
    last_key = re.search(r"(?:^|\n)\s*D\.\s*", rest)
    if last_key:
        after_d = rest[last_key.end() :]
        after_d = re.split(r"\n(?=第\s*\d+\s*题)", after_d, maxsplit=1)[0]
        # strip option D first line-ish: take from first newline-looking code
        mcode = re.search(r"(int |float |double |#include|for |cout |cin |printf|def |print\()", after_d)
        if mcode and mcode.start() > 40:
            code_tail.append(after_d[mcode.start() :].strip())
            d_text = after_d[: mcode.start()].strip()
            d_text = re.sub(r"\n\d+\s*$", "", d_text).strip()
            for o in cleaned_opts:
                if o["key"] == "D":
                    o["text"] = re.sub(r"\s+", " ", d_text)
    tail = "\n".join(x for x in code_tail if x)
    tail = re.sub(r"(?m)^\d+\s*$", "", tail).strip()
    return stem, cleaned_opts, tail


def parse_choice_section(section: str, answers: list[str], kind: str) -> list[dict]:
    items = []
    parts = re.split(r"第\s*(\d+)\s*题", section)
    if len(parts) < 3:
        return items
    for i in range(1, len(parts), 2):
        num = int(parts[i])
        body = parts[i + 1]
        body = re.split(r"\n(?=\d\s+(?:单选题|判断题|编程题))", body)[0]
        if kind == "choice":
            stem, opts, tail = parse_options(body)
            if tail:
                stem = stem + "\n\n```\n" + tail + "\n```"
            if len(opts) < 2:
                # still import stem
                opts = opts or [
                    {"key": "A", "text": "A"},
                    {"key": "B", "text": "B"},
                    {"key": "C", "text": "C"},
                    {"key": "D", "text": "D"},
                ]
            ans = answers[num - 1] if 0 <= num - 1 < len(answers) else ""
            items.append(
                {
                    "seq": num,
                    "kind": "choice",
                    "stem": stem.strip(),
                    "options": opts,
                    "answer": ans,
                }
            )
        else:
            stem = re.split(r"\n(?=第\s*\d+\s*题)", body)[0].strip()
            stem = re.sub(r"(?m)^\d+\s*$", "", stem).strip()
            ans = answers[num - 1] if 0 <= num - 1 < len(answers) else ""
            mapped = {"对": "T", "正确": "T", "√": "T", "T": "T", "错": "F", "错误": "F", "×": "F", "F": "F"}
            items.append(
                {
                    "seq": num,
                    "kind": "tf",
                    "stem": stem,
                    "options": [{"key": "T", "text": "正确"}, {"key": "F", "text": "错误"}],
                    "answer": mapped.get(ans, ans),
                }
            )
    return items


def strip_ref_program(text: str) -> tuple[str, str]:
    m = re.search(r"参考程序", text)
    if not m:
        return text.strip(), ""
    return text[: m.start()].strip(), text[m.end() :].strip()


def clean_reference_code(raw: str) -> str:
    if not raw:
        return ""
    raw = re.split(r"\n\d+\.\d+\s*编程题|\n\d+\s*编程题", raw, maxsplit=1)[0]
    raw = re.split(r"\n试题名称\s*[:：]", raw, maxsplit=1)[0]
    lines = []
    for line in raw.splitlines():
        s = line.strip()
        if re.fullmatch(r"\d+", s):
            continue
        if re.fullmatch(r"\d+\s*/\s*\d+", s):
            continue
        lines.append(line.rstrip())
    code = "\n".join(lines).strip()
    code = re.sub(r"\n{3,}", "\n\n", code)
    return code


def clean_sample_out(token: str) -> tuple[str, bool]:
    s = token.strip()
    suspect = False
    if s.endswith("1") and re.fullmatch(r"-?\d+(?:\.\d+)?", s[:-1] or ""):
        s = s[:-1]
        suspect = True
    if re.fullmatch(r"-?\d+\.\d{3,}", s):
        s = f"{float(s):.2f}"
        suspect = True
    return s + "\n", suspect


def parse_prog_samples(block: str) -> list[dict]:
    m = re.search(r"输入样例|3\.\d+\.\d+\s*样例", block)
    region = block[m.start() :] if m else block
    nums = []
    for line in region.splitlines():
        s = line.strip()
        if re.fullmatch(r"\d+\s*/\s*\d+", s):
            continue
        if re.fullmatch(r"-?\d+(?:\.\d+)?", s):
            nums.append(s)
    pairs = []
    i = 0
    while i < len(nums):
        found = False
        for k in range(1, 25):
            if i + 2 * k >= len(nums):
                break
            data = nums[i : i + k]
            seq = nums[i + k : i + 2 * k]
            if data == [str(j) for j in range(1, k + 1)]:
                continue
            if seq == [str(j) for j in range(1, k + 1)] and i + 2 * k < len(nums):
                inp = "\n".join(data) + "\n"
                out, suspect = clean_sample_out(nums[i + 2 * k])
                pairs.append({"in": inp, "out": out, "suspect": suspect})
                i += 2 * k + 1
                found = True
                break
        if not found:
            i += 1
    return pairs


def parse_programming(section: str) -> list[dict]:
    items = []
    chunks = re.split(r"(?:试题名称\s*[:：]|编程题\s*[12]\s*(?:\n|$))", section)
    headers = list(re.finditer(r"试题名称\s*[:：]\s*(.+)", section))
    if not headers:
        headers = list(re.finditer(r"(\d+\.\d+)\s*编程题", section))
        bodies = re.split(r"\d+\.\d+\s*编程题", section)[1:]
        for idx, body in enumerate(bodies, 1):
            items.append(parse_one_prog(idx, f"编程题 {idx}", body))
        return [x for x in items if x]
    parts = re.split(r"试题名称\s*[:：]\s*", section)[1:]
    for idx, part in enumerate(parts, 1):
        lines = part.splitlines()
        title = (lines[0] if lines else f"编程题 {idx}").strip()
        body = "\n".join(lines[1:])
        items.append(parse_one_prog(idx, title, body))
    return [x for x in items if x]


def parse_one_prog(seq: int, title: str, body: str) -> dict | None:
    body, ref = strip_ref_program(body)
    reference = clean_reference_code(ref)
    tm = re.search(r"时间限制\s*[:：]?\s*([\d.]+)\s*s", body, re.I)
    mm = re.search(r"内存限制\s*[:：]?\s*([\d.]+)\s*MB", body, re.I)
    desc = body
    desc = re.sub(r"(?m)^\d+\s*$", "", desc)
    samples = parse_prog_samples(body)
    # drop 参考程序 leftovers and isolated line numbers from statement
    keep = []
    skip_from_ref = False
    for line in desc.splitlines():
        if re.match(r"#include|using namespace|int main\s*\(", line.strip()):
            skip_from_ref = True
        if skip_from_ref:
            continue
        keep.append(line)
    statement = "\n".join(keep).strip()
    io_at = re.search(r"输入格式", statement)
    if io_at:
        head, tail = statement[: io_at.start()], statement[io_at.start() :]
        cleaned = []
        code_line = re.compile(
            r"^\s*(?:"
            r"#include|using namespace|int |float |double |for |while |cout |cin |printf|if \(|return "
            r"|[a-zA-Z_]\w*\s*(?:\+\+|--|[+\-*/%]=|>>=|<<=|[=<>!]=|=)"
            r"|\}|\{"
            r")"
        )
        for line in head.splitlines():
            if code_line.match(line):
                continue
            cleaned.append(line)
        statement = "\n".join(cleaned).rstrip() + "\n\n" + tail
    statement = re.sub(r"\n{3,}", "\n\n", statement)
    if len(statement) < 20:
        return None
    return {
        "seq": seq,
        "kind": "traditional",
        "title": title[:80] or f"编程题 {seq}",
        "statement": statement,
        "time_ms": int(float(tm.group(1)) * 1000) if tm else 1000,
        "memory_mb": int(float(mm.group(1))) if mm else 512,
        "samples": samples,
        "has_ref": bool(reference),
        "reference": reference,
    }


def parse_paper(text: str, meta: dict) -> dict:
    mcq_sec = split_section(text, r"单选题", [r"判断题", r"编程题"])
    tf_sec = split_section(text, r"判断题", [r"编程题"])
    prog_sec = split_section(text, r"编程题", [])
    mcq_ans = parse_section_answer_table(mcq_sec, "choice")
    tf_ans = parse_section_answer_table(tf_sec, "tf")
    if not mcq_ans and not tf_ans:
        rows = parse_answer_rows(text)
        mcq_ans = rows[0] if rows else []
        tf_ok = {"对", "错", "√", "×", "T", "F", "正确", "错误"}
        if len(rows) > 1 and rows[1] and all(x in tf_ok for x in rows[1]):
            tf_ans = rows[1]
        rows = [mcq_ans, tf_ans]
    else:
        rows = [mcq_ans, tf_ans]
    mcqs = parse_choice_section(mcq_sec, mcq_ans, "choice")
    tfs = parse_choice_section(tf_sec, tf_ans, "tf")
    progs = parse_programming(prog_sec)
    return {
        "meta": meta,
        "choice": mcqs,
        "tf": tfs,
        "program": progs,
        "answer_rows": rows,
    }


def paper_slug(ym: str, lang: str, level: int) -> str:
    return f"{ym}-{lang}-{level}"


def problem_code(ym: str, lang: str, level: int, kind: str, seq: int) -> str:
    tag = {"choice": "C", "tf": "J", "traditional": "P"}[kind]
    lang_tag = "CPP" if lang == "cpp" else "PY"
    return f"GESP-{ym}-{lang_tag}{level}-{tag}{seq:02d}"


def difficulty(level: int) -> str:
    return f"GESP {level}级"


def lang_label(lang: str) -> str:
    return "C++" if lang == "cpp" else "Python"


def ensure_schema(con: sqlite3.Connection) -> None:
    cols = [r[1] for r in con.execute("PRAGMA table_info(problems)")]
    if cols and "review_note" not in cols:
        con.execute("ALTER TABLE problems ADD COLUMN review_note TEXT")
    if cols and "solution_code" not in cols:
        con.execute("ALTER TABLE problems ADD COLUMN solution_code TEXT")


def upsert_problem(con: sqlite3.Connection, row: dict, *, force: bool = False) -> int | None:
    existing = con.execute("SELECT id, published FROM problems WHERE code = ?", (row["code"],)).fetchone()
    if existing and existing[1] == 1 and not force:
        return existing[0]
    if existing:
        con.execute(
            """UPDATE problems SET title=?, source=?, difficulty=?, time_ms=?, memory_mb=?,
               languages=?, type=?, statement=?, sample_in=?, sample_out=?, sample_note=?,
               choice_json=?, full_score=?, published=1, review_note=?, solution_code=? WHERE id=?""",
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
                row.get("solution_code"),
                existing[0],
            ),
        )
        pid = existing[0]
        con.execute("DELETE FROM testcases WHERE problem_id = ?", (pid,))
    else:
        cur = con.execute(
            """INSERT INTO problems (code, title, source, difficulty, time_ms, memory_mb, io_mode,
               languages, type, statement, sample_in, sample_out, sample_note, choice_json, full_score,
               published, review_note, solution_code)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)""",
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
                row.get("solution_code"),
            ),
        )
        pid = cur.lastrowid
    return pid


def write_cases(pid: int, samples: list[dict], full_score: int) -> None:
    d = PROBLEM_DIR / str(pid)
    d.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(samples, 1):
        (d / f"{i}.in").write_text(s["in"], encoding="utf-8")
        (d / f"{i}.out").write_text(s["out"], encoding="utf-8")
        hid = i + len(samples)
        (d / f"{hid}.in").write_text(s["in"], encoding="utf-8")
        (d / f"{hid}.out").write_text(s["out"], encoding="utf-8")


def merge_contest(con: sqlite3.Connection, title: str, program_pids: list[int]) -> int | None:
    """Keep AdaCpp choice/tf order; append programming problems at the end."""
    if not program_pids:
        return None
    ex = con.execute("SELECT id FROM contests WHERE title = ?", (title,)).fetchone()
    if not ex:
        con.execute(
            "INSERT INTO contests (title, rule, duration_min, start_at, end_at, published) VALUES (?,?,?,?,?,1)",
            (title, "practice", 120, "2020-01-01T00:00:00.000Z", "2099-12-31T00:00:00.000Z"),
        )
        cid = con.execute("SELECT last_insert_rowid()").fetchone()[0]
    else:
        cid = ex[0]
    existing = {
        r[0]: r[1]
        for r in con.execute(
            "SELECT problem_id, seq FROM contest_problems WHERE contest_id=?",
            (cid,),
        ).fetchall()
    }
    all_pids: list[int] = []
    seen: set[int] = set()
    for pid, _seq in sorted(existing.items(), key=lambda x: x[1]):
        ptype = con.execute("SELECT type FROM problems WHERE id=?", (pid,)).fetchone()
        if ptype and ptype[0] == "choice":
            all_pids.append(pid)
            seen.add(pid)
    for pid in program_pids:
        if pid not in seen:
            all_pids.append(pid)
            seen.add(pid)
    con.execute("DELETE FROM contest_problems WHERE contest_id=?", (cid,))
    for seq, pid in enumerate(all_pids, 1):
        con.execute(
            "INSERT INTO contest_problems (contest_id, problem_id, seq) VALUES (?,?,?)",
            (cid, pid, seq),
        )
    return cid


def import_paper(con: sqlite3.Connection, parsed: dict) -> dict:
    meta = parsed["meta"]
    ym, lang, level = meta["ym"], meta["lang"], meta["level"]
    note_base = (
        f"来源：CCF GESP 官方 PDF（{meta.get('pdf_url', '')}）。"
        "编程题面与样例由 PDF 抽取，须对照原卷审核。官方通常只给样例，无隐藏测例。"
    )
    program_pids: list[int] = []
    list_row = con.execute("SELECT id FROM problem_lists WHERE slug='gesp'").fetchone()
    list_id = list_row[0] if list_row else None
    max_seq = 0
    if list_id:
        r = con.execute("SELECT COALESCE(MAX(seq),0) FROM problem_list_items WHERE list_id=?", (list_id,)).fetchone()
        max_seq = r[0]

    def add_list(pid: int):
        nonlocal max_seq
        if not list_id:
            return
        ex = con.execute(
            "SELECT 1 FROM problem_list_items WHERE list_id=? AND problem_id=?",
            (list_id, pid),
        ).fetchone()
        if ex:
            return
        max_seq += 1
        con.execute(
            "INSERT INTO problem_list_items (list_id, problem_id, seq) VALUES (?,?,?)",
            (list_id, pid, max_seq),
        )

    for it in parsed["program"]:
        code = problem_code(ym, lang, level, "traditional", it["seq"])
        samples = it.get("samples") or []
        sample_in = samples[0]["in"] if samples else ""
        sample_out = samples[0]["out"] if samples else ""
        flags = []
        if not samples:
            flags.append("缺样例")
        if any(s.get("suspect") for s in samples):
            flags.append("样例可能粘连")
        if not it.get("reference"):
            flags.append("缺满分程序")
        langs = ["cpp"] if lang == "cpp" else ["python"]
        row = {
            "code": code,
            "title": f"GESP {level}级 {it['title']}",
            "source": "gesp",
            "difficulty": difficulty(level),
            "time_ms": it.get("time_ms") or 1000,
            "memory_mb": it.get("memory_mb") or 512,
            "languages": json.dumps(langs),
            "type": "traditional",
            "statement": it["statement"]
            + "\n\n官方试题仅含样例。本站用样例复制为测试点，分数仅供训练参考。",
            "sample_in": sample_in,
            "sample_out": sample_out,
            "sample_note": "由官方 PDF 抽取，请对照原卷。",
            "choice_json": None,
            "full_score": 100,
            "review_note": note_base + ((" 标记：" + "、".join(flags)) if flags else ""),
            "solution_code": it.get("reference") or "",
        }
        pid = upsert_problem(con, row, force=True)
        if pid:
            program_pids.append(pid)
            add_list(pid)
            if samples:
                n = len(samples)
                score_each = max(1, 100 // n)
                scores = [score_each] * n
                scores[-1] = 100 - score_each * (n - 1)
                for i, s in enumerate(samples, 1):
                    con.execute(
                        "INSERT INTO testcases (problem_id, seq, score, is_sample, input_rel, output_rel) VALUES (?,?,?,?,?,?)",
                        (pid, i, 0, 1, f"{i}.in", f"{i}.out"),
                    )
                    hid = i + n
                    con.execute(
                        "INSERT INTO testcases (problem_id, seq, score, is_sample, input_rel, output_rel) VALUES (?,?,?,?,?,?)",
                        (pid, hid, scores[i - 1], 0, f"{hid}.in", f"{hid}.out"),
                    )
                write_cases(pid, samples, 100)

    title = f"GESP {ym[:4]}年{int(ym[4:] or 0)}月 {lang_label(lang)} {level}级"
    cid = merge_contest(con, title, program_pids)
    return {
        "contest_id": cid,
        "title": title,
        "problems": len(program_pids),
        "choice": 0,
        "tf": 0,
        "program": len(parsed["program"]),
    }


def crawl_and_parse(args: argparse.Namespace) -> list[Path]:
    CACHE_GESP.mkdir(parents=True, exist_ok=True)
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    sessions = session_links()
    if args.ym:
        sessions = [s for s in sessions if s["ym"] == args.ym]
    parsed_files = []
    n_pdf = 0
    for sess in sessions:
        if sess["ym"] == "000000":
            print(f"session skip (no date) {sess['url']}", flush=True)
            continue
        print(f"session {sess['ym']} {sess['url']}", flush=True)
        try:
            html = fetch(sess["url"], delay=args.delay).decode("utf-8", "replace")
        except Exception as exc:
            print(f"  FAIL session: {exc}", flush=True)
            continue
        pdfs = pdfs_on_session(html)
        if args.lang:
            pdfs = [p for p in pdfs if p["lang"] == args.lang]
        if args.level:
            pdfs = [p for p in pdfs if p["level"] == args.level]
        pdfs = [p for p in pdfs if p["kind"] == "shiti"]
        for info in pdfs:
            if args.limit and n_pdf >= args.limit:
                return parsed_files
            slug = paper_slug(sess["ym"], info["lang"], info["level"])
            pdf_path = CACHE_GESP / f"{slug}.pdf"
            try:
                if not pdf_path.exists() or pdf_path.stat().st_size < 1000:
                    print(f"  download {info['title']}", flush=True)
                    fetch(info["href"], pdf_path, delay=args.delay)
                else:
                    print(f"  cached {pdf_path.name}", flush=True)
                text = extract_pdf_text(pdf_path)
            except Exception as exc:
                print(f"  FAIL {info['title']}: {exc}", flush=True)
                continue
            meta = {
                "ym": sess["ym"],
                "lang": info["lang"],
                "level": info["level"],
                "title": info["title"],
                "session_url": sess["url"],
                "pdf_url": info["href"],
                "pdf_path": str(pdf_path.relative_to(ROOT)).replace("\\", "/"),
            }
            parsed = parse_paper(text, meta)
            tf_fill = apply_tf_vision(parsed, pdf_path, prefer_vision=getattr(args, "tf_vision", False))
            out = PARSED_DIR / f"{slug}.json"
            out.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
            parsed_files.append(out)
            n_pdf += 1
            print(
                f"    parsed choice={len(parsed['choice'])} tf={len(parsed['tf'])} prog={len(parsed['program'])}"
                + (f" tf_ans+={tf_fill}" if tf_fill else ""),
                flush=True,
            )
    return parsed_files


def import_files(files: list[Path]) -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"database not found: {DB_PATH} (先启动一次 npm run dev 以建库)")
    con = sqlite3.connect(str(DB_PATH))
    con.execute("PRAGMA foreign_keys = ON")
    ensure_schema(con)
    con.execute(
        "UPDATE problem_lists SET blurb=? WHERE slug='gesp'",
        ("选择/判断来自 AdaCpp；编程来自 CCF 官方 PDF",),
    )
    summary = []
    for f in files:
        parsed = json.loads(f.read_text(encoding="utf-8"))
        stat = import_paper(con, parsed)
        summary.append(stat)
        print(f"imported {stat['title']}: {stat['problems']} problems", flush=True)
    con.commit()
    con.close()
    print(f"done papers={len(summary)}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="Import official GESP PDFs into EduHub")
    ap.add_argument("--delay", type=float, default=0.4)
    ap.add_argument("--limit", type=int, default=0, help="max PDFs to download/parse")
    ap.add_argument("--ym", help="only this session, e.g. 202606")
    ap.add_argument("--lang", choices=["cpp", "python"])
    ap.add_argument("--level", type=int)
    ap.add_argument("--skip-crawl", action="store_true", help="only parse/import existing files")
    ap.add_argument("--reparse", action="store_true", help="with --skip-crawl: re-extract PDFs in cache")
    ap.add_argument(
        "--tf-vision",
        action="store_true",
        help="判断题答案：优先用视觉模型识别节首答案表（需 OPENAI_API_KEY 或 Ollama；默认先用矢量符号）",
    )
    ap.add_argument("--no-import", action="store_true")
    args = ap.parse_args()
    if args.skip_crawl:
        files = sorted(PARSED_DIR.glob("*.json"))
        if args.reparse or not files:
            # parse local pdfs
            CACHE_GESP.mkdir(parents=True, exist_ok=True)
            files = []
            for pdf in sorted(CACHE_GESP.glob("*.pdf")):
                stem = pdf.stem
                m = re.match(r"(\d{6})-(cpp|python)-(\d+)$", stem) or re.match(
                    r"(20\d{2})-(\d{2})-(cpp|python)-(\d+)$", stem
                )
                if not m:
                    continue
                if len(m.groups()) == 3:
                    ym, lang, level = m.group(1), m.group(2), int(m.group(3))
                else:
                    ym, lang, level = f"{m.group(1)}{m.group(2)}", m.group(3), int(m.group(4))
                text = extract_pdf_text(pdf)
                parsed = parse_paper(
                    text,
                    {
                        "ym": ym,
                        "lang": lang,
                        "level": level,
                        "title": stem,
                        "pdf_url": "",
                        "pdf_path": str(pdf.relative_to(ROOT)).replace("\\", "/"),
                    },
                )
                apply_tf_vision(parsed, pdf, prefer_vision=args.tf_vision)
                out = PARSED_DIR / f"{stem}.json"
                PARSED_DIR.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
                files.append(out)
            if args.reparse:
                files = sorted(PARSED_DIR.glob("*.json"))
    else:
        files = crawl_and_parse(args)
    if not args.no_import:
        import_files(files)


if __name__ == "__main__":
    main()
