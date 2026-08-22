#!/usr/bin/env node
/**
 * Parse xiaomawang csp_pre/script.js KNOWLEDGE map into seed JSON.
 * Also extracts 历年真题 quiz items (answer + explanation).
 * Usage: node src/op/scrape-xiaomawang-knowledge.mjs [script.js path]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SRC =
  process.argv[2] ||
  path.join(process.env.TEMP || "/tmp", "csp_script.js");
const OUT = path.join(ROOT, "src/rd/server/data/seed/knowledge-topics.json");

function cleanTitle(title) {
  return String(title || "")
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, "")
    .trim();
}

function stripHtmlNoise(html) {
  return String(html || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html) {
  return decodeEntities(String(html || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split content into explain HTML (before quizzes) + structured quizzes. */
function parseContent(rawHtml) {
  const html = stripHtmlNoise(rawHtml);
  const quizHead = html.search(/<h3>[^<]*历年真题[^<]*<\/h3>/i);
  let explain = html;
  let quizHtml = "";
  if (quizHead >= 0) {
    explain = html.slice(0, quizHead).trim();
    quizHtml = html.slice(quizHead);
  }

  const quizzes = [];
  const itemRe = /<div class="qa-item"[^>]*data-correct="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="qa-item"|$|<h3|$)/gi;
  let m;
  while ((m = itemRe.exec(quizHtml || html))) {
    const correct = String(m[1] || "").trim().toUpperCase();
    const block = m[2];
    const stemMatch =
      block.match(/<div class="qa-q"[^>]*>([\s\S]*?)<\/div>/i) ||
      block.match(/<p class="qa-q"[^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const stem = stemMatch ? htmlToText(stemMatch[1]) : "";
    const options = [];
    const optRe = /<button class="quiz-btn"[^>]*data-opt="([A-D])"[^>]*>([\s\S]*?)<\/button>/gi;
    let om;
    while ((om = optRe.exec(block))) {
      options.push({
        key: om[1].toUpperCase(),
        text: stripTags(om[2]).replace(/^[A-D]\.\s*/, ""),
      });
    }
    const ansMatch = block.match(/<div class="qa-ans"[^>]*>([\s\S]*?)<\/div>/i);
    let source = "";
    let explanation = "";
    if (ansMatch) {
      const ansHtml = ansMatch[1];
      const strong = ansHtml.match(/<strong>([\s\S]*?)<\/strong>/i);
      if (strong) {
        const head = stripTags(strong[1]);
        const srcM = head.match(/【([^】]+)】/);
        if (srcM) source = srcM[1];
      }
      const em = ansHtml.match(/<em>([\s\S]*?)<\/em>/i);
      explanation = em ? htmlToText(em[1]) : htmlToText(ansHtml.replace(/<strong>[\s\S]*?<\/strong>/i, ""));
      // Drop leading "答案：X" if duplicated
      explanation = explanation.replace(/^答案[：:]\s*[A-D]\s*/i, "").trim();
    }
    if (stem || options.length) {
      quizzes.push({ stem, options, correct, source, explanation });
    }
  }

  return { content: explain, quizzes };
}

function extractEntries(src) {
  const out = {};
  const re = /KNOWLEDGE\['([^']+)'\]\s*=\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const id = m[1];
    const start = m.index + m[0].length;
    const titleMatch = src.slice(start).match(/title:\s*['"`]([^'"`]+)['"`]/);
    if (!titleMatch) continue;
    const title = cleanTitle(titleMatch[1]);
    const contentIdx = src.indexOf("content:`", start);
    if (contentIdx < 0 || contentIdx - start > 200) continue;
    let i = contentIdx + "content:`".length;
    let content = "";
    while (i < src.length) {
      const ch = src[i];
      if (ch === "`" && src[i - 1] !== "\\") break;
      content += ch;
      i += 1;
    }
    const parsed = parseContent(content);
    out[id] = {
      id,
      title,
      content: parsed.content,
      quizzes: parsed.quizzes,
      track: id.startsWith("s-") ? "csp-s" : "csp-j",
    };
  }
  return out;
}

const LABEL_TO_ID = {
  "冯·诺依曼结构": "kb-von-neumann",
  "进制与转换": "kb-number-system",
  "原码/反码/补码": "kb-original-complement",
  存储单位: "kb-storage-unit",
  "ASCII 编码": "kb-ascii",
  数据类型与大小: "kb-data-types",
  运算符与优先级: "kb-operators",
  输入输出: "kb-io",
  条件与循环: "kb-condition-loop",
  "数组（一维/二维）": "kb-array",
  "字符串 string": "kb-string",
  函数与递归: "kb-function",
  "结构体 struct": "kb-struct",
  "栈（Stack）": "kb-stack",
  "队列（Queue）": "kb-queue",
  链表: "kb-linked-list",
  二叉树: "kb-binary-tree",
  图的基本概念: "kb-graph-basics",
  哈希表: "kb-hash",
  枚举与模拟: "kb-enum-sim",
  排序算法: "kb-sort",
  二分查找: "kb-binary-search",
  递推与递归: "kb-recursion",
  贪心算法: "kb-greedy",
  分治算法: "kb-divide-conquer",
  "动态规划 DP": "kb-dp",
  "DFS 深度优先搜索": "kb-dfs",
  "BFS 广度优先搜索": "kb-bfs",
  最短路径: "kb-dijkstra",
  最小生成树: "kb-mst",
  拓扑排序: "kb-topo",
  质数与最大公约数: "kb-prime-gcd",
  排列组合: "kb-combinatorics",
  容斥原理: "kb-inclusion-exclusion",
  概率初步: "kb-probability",
  编译过程: "s-compile",
  "Linux 常用命令": "s-linux",
  操作系统基础: "s-os-basics",
  指针与动态内存: "s-pointer",
  位运算技巧: "s-bitwise",
  "STL 高级用法": "s-stl-adv",
  线段树: "s-segtree",
  树状数组: "s-fenwick",
  并查集: "s-dsu",
  "字典树 Trie": "s-trie",
  "ST 表（RMQ）": "s-stable",
  "区间 DP": "s-interval-dp",
  "树形 DP": "s-tree-dp",
  "状压 DP": "s-state-dp",
  "数位 DP": "s-digit-dp",
  倍增法: "s-binary-lifting",
  "Tarjan SCC": "s-tarjan",
  "LCA 最近公共祖先": "s-lca",
  二分图匹配: "s-bipartite",
  "网络流 Dinic": "s-dinic",
  "KMP 算法": "s-kmp",
  字符串哈希: "s-string-hash",
  "Manacher 回文串": "s-manacher",
  快速幂: "s-qpow",
  扩展欧几里得: "s-exgcd",
  逆元与模运算: "s-modular",
  组合数学进阶: "s-combinatorics-adv",
};

function patchCmsIds() {
  const cmsPath = path.join(ROOT, "src/rd/server/data/seed/cms.json");
  if (!fs.existsSync(cmsPath)) return;
  const cms = JSON.parse(fs.readFileSync(cmsPath, "utf8"));
  let patched = 0;
  for (const item of cms.syllabus || []) {
    for (const block of item.topic_details || []) {
      for (const pt of block.items || []) {
        const id = LABEL_TO_ID[pt.label];
        if (id) {
          pt.id = id;
          patched += 1;
        }
      }
    }
  }
  fs.writeFileSync(cmsPath, JSON.stringify(cms, null, 2) + "\n", "utf8");
  console.log("patched cms topic ids", patched);
}

if (!fs.existsSync(SRC)) {
  console.error("missing script.js:", SRC);
  console.error("Download first: curl.exe -sL https://student-web.xiaomawang.com/csp_pre/script.js -o %TEMP%\\csp_script.js");
  process.exit(1);
}

const src = fs.readFileSync(SRC, "utf8");
const entries = extractEntries(src);
const list = Object.values(entries);
const withQuiz = list.filter((t) => t.quizzes?.length).length;
const quizCount = list.reduce((n, t) => n + (t.quizzes?.length || 0), 0);
console.log("parsed", list.length, "topics;", withQuiz, "have quizzes;", quizCount, "questions");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ topics: list }, null, 2), "utf8");
console.log("wrote", OUT);
patchCmsIds();

const sample = list.find((t) => t.id === "kb-von-neumann");
if (sample?.quizzes?.[0]) {
  console.log("sample quiz:", sample.quizzes[0].correct, sample.quizzes[0].source, sample.quizzes[0].stem.slice(0, 40));
}
