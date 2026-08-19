<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { localDraft, readLocalPaper, setMarked, writeLocalProgress } from "../paper-save.js";
import { useSession } from "../stores/session.js";
import CodeEditor from "./CodeEditor.vue";
import StatementView from "./StatementView.vue";
import { formatOptionText } from "../statement.js";

const cppTpl = `#include <bits/stdc++.h>
using namespace std;
int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);

  return 0;
}
`;
const pyTpl = `import sys

def main():
    data = sys.stdin.read().split()

if __name__ == "__main__":
    main()
`;

const route = useRoute();
const router = useRouter();
const session = useSession();
const paper = ref(null);
const err = ref("");
const saveHint = ref("");
const loading = ref(true);
const activeId = ref(null);
const marks = reactive({});
const showTopBtn = ref(false);

/** @type {import('vue').Reactive<Record<string, { choice: string, lang: string, code: string, result: any, waiting: string, unofficial: boolean }>>} */
const answers = reactive({});
const saveTimers = {};
const judgeGens = {};
let hydrating = false;
let observer = null;

const paperId = computed(() => Number(route.params.id));

function bankSource() {
  if (route.query.source) return String(route.query.source);
  const src = paper.value?.problems?.find((p) => p.source)?.source;
  return src || "";
}

function ensureAnswer(p) {
  const key = String(p.id);
  if (!answers[key]) {
    answers[key] = {
      choice: "",
      lang: (p.languages && p.languages[0]) || "cpp",
      code: "",
      result: null,
      waiting: "",
      unofficial: false,
    };
  }
  return answers[key];
}

function scoreText(p) {
  if (p.my_score == null) return isAnswered(p) ? "已作答" : "未做";
  return String(p.my_score);
}

function scoreClass(p) {
  if (p.my_score == null) return isAnswered(p) ? "mid" : "muted";
  if (p.my_score >= (p.full_score || 100)) return "ok";
  return "mid";
}

function isAnswered(p) {
  if (p.my_score != null) return true;
  if (p.has_draft) return true;
  return hasContent(p);
}

function tocClass(p) {
  const full = p.full_score || 100;
  return {
    on: Number(activeId.value) === Number(p.id),
    flagged: Boolean(marks[String(p.id)]),
    ok: p.my_score != null && p.my_score >= full,
    mid: p.my_score != null && p.my_score < full,
    draft: p.my_score == null && isAnswered(p),
    todo: !isAnswered(p) && !marks[String(p.id)],
  };
}

function tocLabel(p, i) {
  const code = String(p.code || "");
  const m = code.match(/-([CJP])(\d{2})$/i);
  if (m) {
    const kind = { C: "选择", J: "判断", P: "编程" }[m[1].toUpperCase()];
    const seq = Number(m[2]);
    if (m[1].toUpperCase() === "P") {
      let short = String(p.title || "")
        .replace(/^GESP\s+\d+级\s+(C\+\+|Python)\s+/i, "")
        .replace(/^GESP\s+\d+级\s+/, "")
        .trim();
      if (short && !/^编程\s*\d+$/i.test(short)) return short;
      return `编程 ${seq}`;
    }
    return `${kind} ${seq}`;
  }
  let short = String(p.title || "")
    .replace(/^GESP\s+\d+级\s+(C\+\+|Python)\s+/i, "")
    .replace(/^GESP\s+\d+级\s+/, "")
    .trim();
  if (short) return short;
  if (p.type === "choice") {
    return String(p.title || "").includes("判断") ? `判断 ${i + 1}` : `选择 ${i + 1}`;
  }
  return `第 ${i + 1} 题`;
}

function optionBody(opt) {
  return formatOptionText(opt);
}

function defaultCode(lang) {
  return lang === "python" ? pyTpl : cppTpl;
}

function loadMarks() {
  const local = readLocalPaper(session.user, paperId.value);
  for (const k of Object.keys(marks)) delete marks[k];
  for (const [k, v] of Object.entries(local.marks || {})) {
    if (v) marks[k] = 1;
  }
}

function toggleFlag(p) {
  const key = String(p.id);
  const next = !marks[key];
  setMarked(session.user, paperId.value, p.id, next);
  if (next) marks[key] = 1;
  else delete marks[key];
}

function hydrateProblem(p) {
  const a = ensureAnswer(p);
  const draft = p.draft || localDraft(session.user, paperId.value, p.id);
  if (p.type === "choice") {
    a.choice = draft?.code || "";
  } else {
    a.lang = draft?.language || (p.languages && p.languages[0]) || "cpp";
    a.code = draft?.code || defaultCode(a.lang);
  }
}

function setupObserver() {
  if (observer) observer.disconnect();
  if (!paper.value?.problems?.length) return;
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]?.target?.id?.startsWith("q-")) {
        activeId.value = Number(visible[0].target.id.slice(2));
      }
    },
    { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5] },
  );
  for (const p of paper.value.problems) {
    const el = document.getElementById(`q-${p.id}`);
    if (el) observer.observe(el);
  }
}

async function load() {
  loading.value = true;
  err.value = "";
  try {
    const data = await api(`/api/contests/${paperId.value}/workbook`);
    paper.value = data;
    loadMarks();
    hydrating = true;
    for (const p of data.problems || []) hydrateProblem(p);
    await nextTick();
    hydrating = false;
    if (data.problems?.length) activeId.value = data.problems[0].id;
    setupObserver();
    if (route.hash) {
      const el = document.querySelector(route.hash);
      if (el) el.scrollIntoView({ block: "start" });
    }
  } catch (e) {
    err.value = e.message;
    paper.value = null;
  } finally {
    loading.value = false;
  }
}

function jumpTo(p) {
  activeId.value = p.id;
  const el = document.getElementById(`q-${p.id}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const hash = `#q-${p.id}`;
  if (route.hash !== hash) {
    router.replace({ hash, query: route.query, params: route.params });
  }
}

async function ensureRegistered() {
  if (!session.user || !paper.value) return false;
  try {
    await api(`/api/contests/${paper.value.id}/register`, { method: "POST", body: {} });
    return true;
  } catch {
    return false;
  }
}

function payloadFor(p) {
  const a = ensureAnswer(p);
  if (p.type === "choice") {
    return { problem_id: p.id, language: "choice", code: a.choice };
  }
  return { problem_id: p.id, language: a.lang, code: a.code };
}

function hasContent(p) {
  const a = ensureAnswer(p);
  if (p.type === "choice") return Boolean(String(a.choice || "").trim());
  return Boolean(a.code) && a.code !== defaultCode(a.lang);
}

function scheduleSave(p) {
  if (hydrating || !paper.value) return;
  const key = String(p.id);
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => recordAnswer(p), 800);
}

async function recordAnswer(p) {
  if (!paper.value) return;
  const keep = hasContent(p);
  const payload = payloadFor(p);
  writeLocalProgress(session.user, paper.value.id, p.id, payload.language, payload.code, keep);
  if (keep) p.has_draft = 1;
  if (!session.user) {
    saveHint.value = "已保存在本机。登录后成绩才会记到账号上。";
    return;
  }
  await ensureRegistered();
  try {
    await api(`/api/papers/${paper.value.id}/progress`, { method: "PUT", body: payload });
    saveHint.value = "已保存";
  } catch (e) {
    saveHint.value = e.message;
  }
  if (keep) sendJudge(p, { interactive: false });
}

async function poll(subId, p) {
  const key = String(p.id);
  const gen = (judgeGens[key] = (judgeGens[key] || 0) + 1);
  const a = ensureAnswer(p);
  a.waiting = "评测中";
  a.unofficial = false;
  const tick = async () => {
    if (gen !== judgeGens[key]) return true;
    const s = await api(`/api/submissions/${subId}`);
    if (s.status === "queued" || s.status === "judging") {
      a.waiting = s.status === "queued" ? "排队中" : "评测中";
      return false;
    }
    a.waiting = "";
    a.result = s;
    a.unofficial = Boolean(s.result?.unofficial);
    if (s.score != null) {
      p.my_score = s.score;
      p.has_draft = 0;
    }
    return true;
  };
  if (await tick()) return;
  const timer = setInterval(async () => {
    if (await tick()) clearInterval(timer);
  }, 1200);
}

async function sendJudge(p, { interactive = true, mode = "full" } = {}) {
  const a = ensureAnswer(p);
  if (!session.user) {
    if (interactive) session.openLogin();
    return;
  }
  if (p.type === "choice" && !a.choice) return;
  if (p.type !== "choice" && !hasContent(p)) return;
  await ensureRegistered();
  try {
    const r = await api("/api/submissions", {
      method: "POST",
      body: {
        problem_id: p.id,
        mode,
        language: p.type === "choice" ? "cpp" : a.lang,
        contest_id: paper.value.id,
        code: p.type === "choice" ? a.choice : a.code,
      },
    });
    await poll(r.id, p);
  } catch (e) {
    if (interactive) err.value = e.message;
  }
}

function onChoice(p) {
  scheduleSave(p);
}

function onCodeChange(p) {
  scheduleSave(p);
}

function onLangChange(p) {
  const a = ensureAnswer(p);
  if (!a.code || a.code === cppTpl || a.code === pyTpl) a.code = defaultCode(a.lang);
  scheduleSave(p);
}

function explain(status) {
  return (
    {
      AC: "通过",
      WA: "答案错误",
      TLE: "超时",
      RE: "运行错误",
      CE: "编译失败",
      PART: "部分分",
      submitted: "已记下",
    }[status] || status
  );
}

function resultLabel(a) {
  if (!a.result) return "";
  if (a.result.status === "submitted") {
    return a.result.result?.unscored ? "已记下，不评分" : "已记下";
  }
  return explain(a.result.status);
}

function backToBank() {
  const src = bankSource();
  router.push({ path: "/problems", query: src ? { source: src } : {} });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function onWindowScroll() {
  showTopBtn.value = window.scrollY > 320;
}

onMounted(() => {
  load();
  window.addEventListener("scroll", onWindowScroll, { passive: true });
  onWindowScroll();
});
watch(() => route.params.id, load);
watch(() => session.user?.id, () => {
  if (paper.value) loadMarks();
});
onUnmounted(() => {
  for (const t of Object.values(saveTimers)) clearTimeout(t);
  if (observer) observer.disconnect();
  window.removeEventListener("scroll", onWindowScroll);
});
</script>

<template>
  <div class="full">
    <div class="wide workbook-top">
      <p class="muted">
        <a href="#" @click.prevent="backToBank">← 题库</a>
        <template v-if="paper"> · {{ paper.title }}</template>
      </p>
      <h1 v-if="paper" class="serif">{{ paper.title }}</h1>
      <p v-if="paper" class="muted">本卷 {{ paper.problems.length }} 题。左侧可跳转；标记用于稍后复查。</p>
      <p v-if="saveHint" class="muted">{{ saveHint }}</p>
      <p v-if="err" class="err">{{ err }}</p>
      <p v-if="loading" class="muted">载入中</p>
    </div>

    <div v-if="paper && !loading" class="workbook-layout">
      <aside class="workbook-toc">
        <p class="workbook-toc-title muted">目录</p>
        <div class="workbook-toc-nums">
          <a
            v-for="(p, i) in paper.problems"
            :key="p.id"
            href="#"
            class="workbook-toc-num"
            :class="tocClass(p)"
            :title="`${tocLabel(p, i)} · ${scoreText(p)}${marks[String(p.id)] ? ' · 已标记' : ''}`"
            @click.prevent="jumpTo(p)"
          >
            <span class="workbook-toc-idx mono">{{ i + 1 }}</span>
            <span class="workbook-toc-name">{{ tocLabel(p, i) }}</span>
            <span v-if="session.user?.role === 'coach' && !p.has_answer" class="tag-warn">无</span>
          </a>
        </div>
        <p class="workbook-legend muted">
          灰框未做 · 浅底已作答 · 绿满分 · 褐部分分 · 靛蓝边为标记
        </p>
      </aside>

      <div class="workbook">
        <section v-for="(p, i) in paper.problems" :id="`q-${p.id}`" :key="p.id" class="workbook-item">
          <header class="workbook-head">
            <span class="mono indigo">{{ i + 1 }}</span>
            <span class="mono muted">{{ p.code }}</span>
            <strong>{{ p.title }}</strong>
            <span v-if="session.user?.role === 'coach' && !p.has_answer" class="tag-warn">无答案</span>
            <span :class="scoreClass(p)" class="workbook-score">{{ scoreText(p) }}</span>
            <button
              class="btn-ghost workbook-flag"
              type="button"
              :class="{ on: marks[String(p.id)] }"
              @click="toggleFlag(p)"
            >{{ marks[String(p.id)] ? "取消标记" : "标记" }}</button>
          </header>
          <div class="solve">
            <div class="solve-stem">
              <StatementView :text="p.statement" />
              <template v-if="p.sample_in">
                <h3>样例</h3>
                <div class="pre">{{ p.sample_in }}</div>
                <div class="pre">{{ p.sample_out }}</div>
                <p v-if="p.sample_note" class="muted">{{ p.sample_note }}</p>
              </template>
              <p v-if="p.type === 'traditional'" class="muted">
                {{ p.time_ms }} ms · {{ p.memory_mb }} MB · {{ p.io_mode === "stdin" ? "标准输入输出" : p.io_mode }}
              </p>
            </div>
            <div class="solve-answer">
              <h3 class="solve-answer-head">作答</h3>
              <template v-if="p.type === 'choice'">
                <label v-for="opt in p.choice?.options || []" :key="opt.key" class="choice-opt">
                  <input v-model="ensureAnswer(p).choice" type="radio" :value="opt.key" @change="onChoice(p)" />
                  <span class="choice-body">
                    <span class="choice-key">{{ opt.key }}.</span>
                    <StatementView v-if="optionBody(opt)" class="choice-rich" :text="optionBody(opt)" />
                  </span>
                </label>
              </template>
              <template v-else>
                <label class="field">语言
                  <select v-model="ensureAnswer(p).lang" @change="onLangChange(p)">
                    <option v-for="l in p.languages" :key="l" :value="l">{{ l === "cpp" ? "C++" : "Python" }}</option>
                  </select>
                </label>
                <CodeEditor
                  v-model="ensureAnswer(p).code"
                  :language="ensureAnswer(p).lang"
                  @update:model-value="onCodeChange(p)"
                />
                <div class="solve-bar">
                  <button
                    class="btn-ghost"
                    type="button"
                    :disabled="!p.sample_in"
                    @click="sendJudge(p, { mode: 'sample' })"
                  >运行样例</button>
                </div>
              </template>
              <p v-if="!p.has_answer" class="muted">本题还没有标准答案。作答会记下，但不评分。</p>
              <p v-if="ensureAnswer(p).waiting" class="muted">{{ ensureAnswer(p).waiting }}</p>
              <p v-if="ensureAnswer(p).unofficial" class="muted">非正式分。仅跑了公开样例。</p>
              <div v-if="ensureAnswer(p).result">
                <p>
                  结果：{{ resultLabel(ensureAnswer(p)) }}
                  <span v-if="ensureAnswer(p).result.score != null && ensureAnswer(p).result.status !== 'submitted'">
                    · {{ ensureAnswer(p).result.score }} 分
                  </span>
                </p>
                <p v-if="ensureAnswer(p).result.result?.error" class="pre">{{ ensureAnswer(p).result.result.error }}</p>
                <table
                  v-if="ensureAnswer(p).result.result?.cases?.length && ensureAnswer(p).result.status !== 'submitted'"
                  class="table"
                >
                  <tr><th>点</th><th>结果</th><th>分</th></tr>
                  <tr v-for="c in ensureAnswer(p).result.result.cases" :key="c.seq">
                    <td class="mono">{{ c.seq }}</td>
                    <td :class="c.result === 'AC' ? 'ok' : 'bad'">{{ c.result }} {{ explain(c.result) }}</td>
                    <td>{{ c.score }}</td>
                  </tr>
                </table>
              </div>
            </div>
          </div>
        </section>
        <p class="muted" style="padding: 1rem 0 3rem">本卷结束。<a href="#" @click.prevent="backToBank">返回题库</a></p>
      </div>
    </div>

    <button
      v-show="showTopBtn"
      class="back-top"
      type="button"
      aria-label="回到顶部"
      @click="scrollToTop"
    >顶部</button>
  </div>
</template>
