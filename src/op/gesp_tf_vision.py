#!/usr/bin/env python3
"""Local GESP judgment (TF) answer extraction from CCF PDF answer tables.

Judgment answers are often vector √/× glyphs, not Unicode text. This module:
  1. Renders the answer-row strip and classifies via a vision model (preferred).
  2. Falls back to vector-path heuristics when no vision provider is configured.

Used only during local import (`gesp_import.py`); not loaded by the online API server.
"""

from __future__ import annotations

import base64
import json
import os
import re
from collections import defaultdict
from pathlib import Path

try:
    import pymupdf
except ImportError:
    pymupdf = None  # type: ignore


PROMPT = """这是一张 GESP 真题 PDF 中「判断题」节首答案表截图。
第一行是题号 1-10，第二行是对应答案，符号为红色 √（对）或 ×（错）。

请只输出 JSON 数组，共 10 个元素，按题号 1 到 10 顺序：
- 对/√ 用 "T"
- 错/× 用 "F"

示例：["F","T","T","F","T","F","T","F","F","T"]
不要输出其它文字。"""


def _parse_tf_json(text: str) -> list[str] | None:
    text = text.strip()
    m = re.search(r"\[[\s\S]*?\]", text)
    if not m:
        return None
    try:
        arr = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(arr, list) or len(arr) != 10:
        return None
    out: list[str] = []
    for v in arr:
        s = str(v).strip().upper()
        if s in ("T", "TRUE", "对", "正确", "√", "✓"):
            out.append("T")
        elif s in ("F", "FALSE", "错", "错误", "×", "✗"):
            out.append("F")
        else:
            return None
    return out


def _vision_openai(png: bytes) -> list[str] | None:
    try:
        from openai import OpenAI
    except ImportError:
        return None
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    model = os.environ.get("GESP_TF_VISION_MODEL", "gpt-4o")
    client = OpenAI(api_key=api_key)
    b64 = base64.standard_b64encode(png).decode("ascii")
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            }
        ],
        max_tokens=120,
        temperature=0,
    )
    text = (resp.choices[0].message.content or "").strip()
    return _parse_tf_json(text)


def _vision_ollama(png: bytes) -> list[str] | None:
    try:
        import ollama
    except ImportError:
        return None
    model = os.environ.get("GESP_TF_VISION_MODEL", "llava:13b")
    b64 = base64.standard_b64encode(png).decode("ascii")
    resp = ollama.chat(
        model=model,
        messages=[
            {
                "role": "user",
                "content": PROMPT,
                "images": [b64],
            }
        ],
        options={"temperature": 0},
    )
    text = (resp.get("message") or {}).get("content") or ""
    return _parse_tf_json(text)


def classify_strip_vision(png: bytes) -> list[str] | None:
    provider = os.environ.get("GESP_TF_VISION_PROVIDER", "auto").lower()
    if provider in ("openai", "auto") and os.environ.get("OPENAI_API_KEY"):
        ans = _vision_openai(png)
        if ans:
            return ans
    if provider in ("ollama", "auto"):
        ans = _vision_ollama(png)
        if ans:
            return ans
    if provider == "openai":
        return _vision_openai(png)
    if provider == "ollama":
        return _vision_ollama(png)
    return None


def _find_tf_table(page) -> tuple[list[float], float, float, float] | None:
    """Return (column_centers_x, answer_row_y, clip_y0, clip_y1) or None."""
    words = page.get_text("words")
    if not any("判断题" in w[4] for w in words):
        return None

    ans_words = [w for w in words if w[4] == "答案"]
    if not ans_words:
        return None
    aw = ans_words[0]
    ay = (aw[1] + aw[3]) / 2

    # 题号行在「答案」行上方；只取与题号行同一 band 的数字 1–10
    num_candidates: list[tuple[int, float, float]] = []
    for w in words:
        raw = w[4].strip()
        if not raw.isdigit():
            continue
        try:
            n = int(raw)
        except ValueError:
            continue
        if not 1 <= n <= 10:
            continue
        cy = (w[1] + w[3]) / 2
        if cy >= ay - 2:  # must be above answer row
            continue
        if ay - cy > 40:  # too far above
            continue
        num_candidates.append((n, (w[0] + w[2]) / 2, cy))

    if not num_candidates:
        return None

    # pick the y-band with the most question numbers (1–10 header row)
    bands: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for n, cx, cy in num_candidates:
        band = int(round(cy / 2.0) * 2)
        bands[band].append((n, cx))

    best_band = max(bands.keys(), key=lambda b: len({n for n, _ in bands[b]}))
    by_n: dict[int, float] = {}
    for n, cx in bands[best_band]:
        if n not in by_n:
            by_n[n] = cx

    if len(by_n) < 8:
        return None

    cols = [by_n[i] for i in range(1, 11) if i in by_n]
    y0 = aw[1] - 4
    y1 = aw[3] + 14
    return cols, ay, y0, y1


def _render_strip(page, cols: list[float], y0: float, y1: float, zoom: float = 4.0) -> bytes:
    x0 = min(cols) - 22
    x1 = max(cols) + 22
    clip = pymupdf.Rect(x0, y0, x1, y1)
    mat = pymupdf.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
    return pix.tobytes("png")


def _extract_via_symbols(page, cols: list[float], ay: float) -> list[str]:
    """Match vector √/× by path complexity (27 vs 30 items in CCF PDFs)."""
    draws = page.get_drawings()
    sym: list[tuple[float, int]] = []
    for d in draws:
        rect = d.get("rect")
        if not rect:
            continue
        n_items = len(d.get("items") or [])
        if n_items not in (27, 30):
            continue
        cx = (rect.x0 + rect.x1) / 2
        cy = (rect.y0 + rect.y1) / 2
        if abs(cy - ay) > 12:
            continue
        sym.append((cx, n_items))

    out: list[str] = []
    for cx in cols:
        best_n = None
        best_d = 999.0
        for scx, n_items in sym:
            d = abs(scx - cx)
            if d < best_d:
                best_d = d
                best_n = n_items
        if best_n == 27:
            out.append("T")
        elif best_n == 30:
            out.append("F")
        else:
            out.append("")
    return out


def extract_tf_answers(pdf_path: str | Path, *, prefer_vision: bool | None = None) -> list[str]:
    """Extract 10 judgment answers (T/F) from a GESP shiti PDF. Missing → ''."""
    if pymupdf is None:
        return [""] * 10

    path = Path(pdf_path)
    if not path.is_file():
        return [""] * 10

    if prefer_vision is None:
        prefer_vision = os.environ.get("GESP_TF_VISION", "").strip().lower() in ("1", "true", "yes")

    doc = pymupdf.open(str(path))
    try:
        for pi in range(len(doc)):
            page = doc[pi]
            found = _find_tf_table(page)
            if not found:
                continue
            cols, ay, y0, y1 = found
            if len(cols) < 8:
                continue

            sym_ans = _extract_via_symbols(page, cols, ay)
            if prefer_vision or sym_ans.count("") > 2:
                png = _render_strip(page, cols, y0, y1)
                vis = classify_strip_vision(png)
                if vis and len(vis) == 10:
                    return vis
            if sym_ans and sym_ans.count("") <= 2:
                # pad to 10
                while len(sym_ans) < 10:
                    sym_ans.append("")
                return sym_ans[:10]

            if not prefer_vision:
                png = _render_strip(page, cols, y0, y1)
                vis = classify_strip_vision(png)
                if vis:
                    return vis
            return sym_ans[:10] if sym_ans else [""] * 10
    finally:
        doc.close()
    return [""] * 10


def enrich_parsed_tf(parsed: dict, pdf_path: str | Path, *, prefer_vision: bool | None = None) -> int:
    """Fill empty tf[].answer in parsed paper dict. Returns count filled."""
    tfs = parsed.get("tf") or []
    if not tfs:
        return 0
    if all(str(q.get("answer") or "").strip() for q in tfs):
        return 0

    answers = extract_tf_answers(pdf_path, prefer_vision=prefer_vision)
    filled = 0
    for i, q in enumerate(tfs):
        if str(q.get("answer") or "").strip():
            continue
        if i < len(answers) and answers[i] in ("T", "F"):
            q["answer"] = answers[i]
            filled += 1
    if filled:
        meta = parsed.setdefault("meta", {})
        meta["tf_vision_filled"] = filled
    return filled
