import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import cpp from "highlight.js/lib/languages/cpp";
import python from "highlight.js/lib/languages/python";

hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("c++", cpp);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlight(code, lang) {
  const id = lang && hljs.getLanguage(lang) ? lang : guessLang(code);
  try {
    return hljs.highlight(code, { language: id, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

function guessLang(code) {
  if (/^\s*(def |import |from\s+\w+\s+import|print\()/m.test(code)) return "python";
  if (/^\s*#include|std::|cout\s*<</m.test(code)) return "cpp";
  return "cpp";
}

function isNoiseLine(line) {
  const t = line.trim();
  if (!t) return false;
  if (/^\d{1,3}$/.test(t)) return true;
  if (/^题号(\s+\d+)+\s*$/.test(t)) return true;
  if (/^答案\s*$/.test(t)) return true;
  return false;
}

function isCodeLine(line) {
  const t = line.trim();
  if (!t || isNoiseLine(line)) return false;

  if (/_{3,}/.test(t)) return true;
  if (/^(#include|using\s+namespace|#define|#pragma)\b/.test(t)) return true;
  if (/^(cout|cin|cerr|printf|scanf|puts|gets)\b/.test(t)) return true;
  if (/^(for|while|do|if|else|elif|switch|case|default|return|break|continue|goto)\b/.test(t)) return true;
  if (/^(int|void|char|bool|long|double|float|auto|string|unsigned|const|struct|class|enum|typedef|template|namespace)\b/.test(t)) return true;
  if (/^(def|import|from|print|lambda|pass|try|except|finally|with|async|await)\b/.test(t)) return true;
  if (/^std::/.test(t)) return true;
  if (/^[{}]\s*(\/\/.*)?$/.test(t)) return true;

  const codePart = t.replace(/\/\/.*$/, "").trim();
  const cjk = (codePart.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk >= 4) return false;
  if (/[;{}]\s*$/.test(codePart)) return true;
  if (/^\s{2,}\S/.test(line) && /[;{}()=<>]/.test(codePart)) return true;
  return false;
}

/** Wrap consecutive code lines in fences; drop PDF line-number / answer-key junk. */
export function fenceLooseCode(src) {
  if (/```/.test(src)) return mergeAdjacentFences(src);
  const lines = String(src).split(/\r?\n/);
  const out = [];
  let buf = [];

  const flush = () => {
    while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
    if (!buf.length) return;
    const body = buf.join("\n");
    out.push("```" + guessLang(body));
    out.push(...buf);
    out.push("```");
    buf = [];
  };

  for (const line of lines) {
    if (isNoiseLine(line)) {
      flush();
      continue;
    }
    if (!line.trim()) {
      if (buf.length) {
        buf.push(line);
      } else {
        out.push("");
      }
      continue;
    }
    if (isCodeLine(line)) {
      buf.push(line);
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return mergeAdjacentFences(out.join("\n"));
}

/** Join code fences that only have blank lines between them into one block. */
export function mergeAdjacentFences(src) {
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  const parts = [];
  let last = 0;
  let m;
  const text = String(src);
  while ((m = re.exec(text))) {
    parts.push({ type: "text", value: text.slice(last, m.index) });
    parts.push({ type: "code", lang: (m[1] || "").trim(), body: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  parts.push({ type: "text", value: text.slice(last) });

  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type !== "code") {
      out.push(p);
      continue;
    }
    let lang = p.lang;
    let body = p.body;
    while (i + 2 < parts.length && parts[i + 1].type === "text" && !parts[i + 1].value.trim() && parts[i + 2].type === "code") {
      body = `${body}\n${parts[i + 2].body}`;
      if (!lang) lang = parts[i + 2].lang;
      i += 2;
    }
    out.push({ type: "code", lang, body });
  }

  return out
    .map((p) => {
      if (p.type === "text") return p.value;
      const lang = p.lang || guessLang(p.body);
      return "```" + lang + "\n" + p.body + "\n```";
    })
    .join("");
}

function isCodeExpr(text) {
  const t = String(text || "").trim();
  if (!t || /[\u4e00-\u9fff]/.test(t)) return false;
  if (/```|`/.test(t)) return false;
  return /[=<>!+\-*/%&|^~]|_{2,}|\b(int|void|char|bool|long|cin|cout|true|false|NULL|nullptr|def|print)\b/.test(t);
}

/** Prepare choice option text for StatementView (inline-code when it looks like code). */
export function formatOptionText(opt) {
  let text = optionCaption(opt);
  if (!text) return "";
  if (/```/.test(text) || /`/.test(text) || /\n/.test(text)) return text;
  if (isCodeExpr(text)) return "`" + text.replace(/`/g, "") + "`";
  return text;
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      return `<pre class="pre statement-code"><code class="hljs">${highlight(text, lang)}</code></pre>`;
    },
    codespan({ text }) {
      return `<code class="inline-code">${escapeHtml(text)}</code>`;
    },
  },
});

export function renderStatement(raw) {
  const src = fenceLooseCode(String(raw || "").trim());
  if (!src) return "";
  const html = marked.parse(src, { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

export function optionCaption(opt) {
  const key = String(opt?.key || "").trim();
  let text = String(opt?.text || "").trim();
  if (!text || text === key || text === `${key}.`) return "";
  text = text.replace(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\s*`), "");
  return text;
}
