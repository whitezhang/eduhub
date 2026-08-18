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

const CODEISH =
  /^\s*(?:#include|using\s+namespace|int\s+main|void\s+\w+\s*\(|printf\s*\(|std::|cout\s|cin\s|def\s+\w+|print\s*\(|for\s*\(|while\s*\(|if\s*\([^)]*\)\s*\{)/;

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
  if (/^\s*#include|std::|cout\s*<</m.test(code)) return "cpp";
  if (/^\s*(def |import |print\()/m.test(code)) return "python";
  return "cpp";
}

function fenceLooseCode(src) {
  if (/```/.test(src)) return src;
  const lines = String(src).split(/\r?\n/);
  const out = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const n = buf.filter((l) => CODEISH.test(l)).length;
    if (n > 0 && n >= Math.ceil(buf.length / 2)) {
      out.push("```\n" + buf.join("\n") + "\n```");
    } else {
      out.push(...buf);
    }
    buf = [];
  };
  for (const line of lines) {
    if (!line.trim()) {
      flush();
      out.push("");
    } else {
      buf.push(line);
    }
  }
  flush();
  return out.join("\n");
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
