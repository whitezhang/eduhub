<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { localDraft, writeLocalProgress } from "../paper-save.js";
import { useSession } from "../stores/session.js";
import { useAuthWall } from "../composables/useAuthWall.js";
import AuthWallSkeleton from "../components/AuthWallSkeleton.vue";
import CodeEditor from "./CodeEditor.vue";
import StatementView from "./StatementView.vue";
import { formatOptionText } from "../statement.js";


const route = useRoute();
const router = useRouter();
const session = useSession();
const { locked } = useAuthWall();
const problem = ref(null);
const err = ref("");
const lang = ref("cpp");
const code = ref("");
const choice = ref("");
const result = ref(null);
const waiting = ref("");
const unofficial = ref(false);
const saveHint = ref("");
const hydrating = ref(false);
let timer = null;
let saveTimer = null;
let judgeGen = 0;
let loadSeq = 0;
let recording = false;
let pendingRecord = false;
let lastSentKey = "";

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

const paper = computed(() => problem.value?.paper || null);
const paperIndex = computed(() => {
  if (!paper.value) return -1;
  const id = Number(route.params.id);
  return paper.value.problems.findIndex((p) => Number(p.id) === id);
});
const prevProblem = computed(() => {
  const i = paperIndex.value;
  if (i <= 0) return null;
  return paper.value.problems[i - 1];
});
const nextProblem = computed(() => {
  const i = paperIndex.value;
  if (i < 0 || i >= paper.value.problems.length - 1) return null;
  return paper.value.problems[i + 1];
});
const contestId = computed(() => paper.value?.id || (route.query.contest ? Number(route.query.contest) : null));

function localScope() {
  return contestId.value || (problem.value ? `p${problem.value.id}` : "solo");
}

function paperHref(pid) {
  const q = contestId.value ? { contest: String(contestId.value) } : {};
  return { path: `/problems/${pid}`, query: q };
}

function goNeighbor(p) {
  if (!p) return;
  router.push(paperHref(p.id));
}

function chipClass(p) {
  const full = p.full_score || 100;
  const currentId = Number(route.params.id);
  return {
    on: Number(p.id) === currentId,
    ok: p.my_score != null && p.my_score >= full,
    mid: p.my_score != null && p.my_score < full,
    draft: p.my_score == null && p.has_draft,
  };
}

function chipTitle(p) {
  const full = p.full_score || 100;
  if (p.my_score != null && p.my_score >= full) return `${p.title} · ${p.my_score} 分满分`;
  if (p.my_score != null) return `${p.title} · ${p.my_score} 分`;
  if (p.has_draft) return `${p.title} · 已作答`;
  return `${p.title} · 未做`;
}

function markDraft(pid) {
  const item = paper.value?.problems.find((p) => p.id === pid);
  if (item && item.my_score == null) item.has_draft = 1;
}

function currentPayload() {
  const isChoice = problem.value?.type === "choice";
  return {
    problem_id: problem.value.id,
    language: isChoice ? "choice" : lang.value,
    code: isChoice ? choice.value : code.value,
  };
}

function hasContent() {
  if (!problem.value) return false;
  if (problem.value.type === "choice") return Boolean(String(choice.value || "").trim());
  const tpl = lang.value === "python" ? pyTpl : cppTpl;
  return Boolean(code.value) && code.value !== tpl;
}

async function flushSave() {
  if (!problem.value) return;
  const payload = currentPayload();
  const keepDraft = hasContent();
  writeLocalProgress(session.user, localScope(), payload.problem_id, payload.language, payload.code, keepDraft);
  if (keepDraft) markDraft(payload.problem_id);
  if (!session.user) {
    saveHint.value = "已保存在本机。登录后成绩才会记到账号上。";
    return;
  }
  if (!paper.value) {
    saveHint.value = "已保存";
    return;
  }
  try {
    await api(`/api/papers/${paper.value.id}/progress`, { method: "PUT", body: payload });
    saveHint.value = "已保存";
  } catch (e) {
    saveHint.value = e.message;
  }
}

function scheduleSave() {
  if (hydrating.value || !problem.value) return;
  clearTimeout(saveTimer);
  const wait = problem.value.type === "choice" ? 350 : 900;
  saveTimer = setTimeout(() => {
    recordAnswer();
  }, wait);
}

function answerKey() {
  if (!problem.value) return "";
  const p = currentPayload();
  return `${p.problem_id}:${p.language}:${p.code}`;
}

async function recordAnswer() {
  if (hydrating.value || !problem.value) return;
  await flushSave();
  if (!session.user || !hasContent()) return;
  const key = answerKey();
  if (key === lastSentKey) return;
  if (recording) {
    pendingRecord = true;
    return;
  }
  recording = true;
  try {
    const ok = await send("full", { interactive: false });
    if (ok) lastSentKey = key;
  } finally {
    recording = false;
    if (pendingRecord) {
      pendingRecord = false;
      recordAnswer();
    }
  }
}

async function loadProblem() {
  const outgoing = problem.value
    ? {
        id: problem.value.id,
        language: problem.value.type === "choice" ? "choice" : lang.value,
        code: problem.value.type === "choice" ? choice.value : code.value,
        keep: hasContent(),
        contestId: contestId.value,
        paperId: paper.value?.id,
      }
    : null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  clearTimeout(saveTimer);
  pendingRecord = false;
  lastSentKey = "";
  judgeGen += 1;
  const seq = ++loadSeq;
  hydrating.value = true;
  err.value = "";
  if (outgoing?.paperId) {
    writeLocalProgress(
      session.user,
      outgoing.paperId,
      outgoing.id,
      outgoing.language,
      outgoing.code,
      outgoing.keep,
    );
    if (outgoing.keep) markDraft(outgoing.id);
    if (session.user) {
      api(`/api/papers/${outgoing.paperId}/progress`, {
        method: "PUT",
        body: { problem_id: outgoing.id, language: outgoing.language, code: outgoing.code },
      }).catch(() => {});
      if (outgoing.keep) sendOutgoing(outgoing);
    }
  } else if (outgoing?.keep) {
    writeLocalProgress(session.user, `p${outgoing.id}`, outgoing.id, outgoing.language, outgoing.code, true);
  }
  const contestQ = route.query.contest ? `?contest=${encodeURIComponent(route.query.contest)}` : "";
  try {
    const next = await api(`/api/problems/${route.params.id}${contestQ}`);
    if (seq !== loadSeq) return;
    result.value = null;
    waiting.value = "";
    unofficial.value = false;
    saveHint.value = "";
    choice.value = "";
    problem.value = next;
    lang.value = next.languages?.[0] || "cpp";
    code.value = lang.value === "python" ? pyTpl : cppTpl;
    const scope = next.paper?.id || (route.query.contest ? Number(route.query.contest) : `p${next.id}`);
    const local = localDraft(session.user, scope, next.id);
    const draft = next.draft || local;
    if (draft?.code) {
      if (next.type === "choice") choice.value = draft.code;
      else {
        if (draft.language === "python" || draft.language === "cpp") lang.value = draft.language;
        code.value = draft.code;
      }
    }
    if (paper.value) {
      const localPaper = writeLocalProgress(
        session.user,
        paper.value.id,
        next.id,
        next.type === "choice" ? "choice" : lang.value,
        next.type === "choice" ? choice.value : code.value,
        hasContent(),
      );
      for (const p of paper.value.problems) {
        if (localPaper.drafts[String(p.id)]) p.has_draft = 1;
      }
      if (session.user) {
        api(`/api/papers/${paper.value.id}/progress`, {
          method: "PUT",
          body: currentPayload(),
        }).catch(() => {});
      }
    } else if (hasContent()) {
      writeLocalProgress(
        session.user,
        `p${next.id}`,
        next.id,
        next.type === "choice" ? "choice" : lang.value,
        next.type === "choice" ? choice.value : code.value,
        true,
      );
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    err.value = e.message;
    if (!problem.value) problem.value = null;
  }
  if (seq !== loadSeq) return;
  await nextTick();
  hydrating.value = false;
}

watch(
  () => [route.params.id, route.query.contest, session.user],
  () => {
    if (!session.user) return;
    loadProblem();
  },
  { immediate: true },
);

watch([choice, code, lang], () => {
  scheduleSave();
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  clearTimeout(saveTimer);
  recordAnswer();
});

async function poll(id, gen, forProblemId) {
  const show = () => gen === judgeGen;
  if (show()) {
    waiting.value = "评测中";
    unofficial.value = false;
  }
  let localTimer = null;
  const tick = async () => {
    const s = await api(`/api/submissions/${id}`);
    if (s.status === "queued" || s.status === "judging") {
      if (show()) waiting.value = s.status === "queued" ? "排队中" : "评测中";
      return false;
    }
    if (localTimer) {
      clearInterval(localTimer);
      localTimer = null;
    }
    if (show()) {
      waiting.value = "";
      result.value = s;
      unofficial.value = Boolean(s.result?.unofficial);
    }
    if (paper.value) {
      const item = paper.value.problems.find((p) => Number(p.id) === Number(forProblemId));
      if (item) {
        if (s.score != null) {
          item.my_score = s.score;
          item.has_draft = 0;
        } else {
          item.has_draft = 1;
        }
      }
    }
    return true;
  };
  if (await tick()) return;
  localTimer = setInterval(async () => {
    if (await tick()) {
      clearInterval(localTimer);
      localTimer = null;
    }
  }, 1200);
  if (show()) timer = localTimer;
}

async function sendOutgoing(outgoing) {
  try {
    const payload = {
      problem_id: outgoing.id,
      mode: "full",
      language: outgoing.language === "choice" ? "cpp" : outgoing.language,
      contest_id: outgoing.contestId,
      code: outgoing.code,
    };
    const r = await api("/api/submissions", { method: "POST", body: payload });
    await poll(r.id, -1, outgoing.id);
  } catch {
    /* 换题后的后台评测失败不影响当前页 */
  }
}

async function send(mode, { interactive = true } = {}) {
  err.value = "";
  if (!session.user) {
    if (interactive) session.openLogin();
    return;
  }
  try {
    await flushSave();
    const payload = {
      problem_id: problem.value.id,
      mode,
      language: lang.value,
      contest_id: contestId.value,
      code: problem.value.type === "choice" ? choice.value : code.value,
    };
    const gen = ++judgeGen;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const judgedId = problem.value.id;
    const r = await api("/api/submissions", { method: "POST", body: payload });
    await poll(r.id, gen, judgedId);
    return true;
  } catch (e) {
    err.value = e.message;
    return false;
  }
}

function explain(r) {
  const map = { AC: "通过", WA: "答案错误", TLE: "超时", RE: "运行错误", CE: "编译失败", PART: "部分分" };
  return map[r] || r;
}

function resultLabel() {
  if (!result.value) return "";
  if (result.value.status === "submitted") {
    return result.value.result?.unscored ? "已记下，不评分" : "已记下";
  }
  return explain(result.value.status);
}

function optionBody(opt) {
  return formatOptionText(opt);
}
</script>

<template>
  <AuthWallSkeleton v-if="locked" variant="problems" />
  <template v-else>
  <div v-if="err && !problem" class="wide err">{{ err }}</div>
  <div v-else-if="problem" class="full">
    <div class="wide" style="margin-bottom:0.75rem">
      <nav v-if="paper" class="exam-nav">
        <div class="exam-nav-head">
          <router-link :to="`/problems/papers/${paper.id}`">{{ paper.title }}</router-link>
          <span class="muted mono">{{ paperIndex + 1 }} / {{ paper.problems.length }}</span>
          <span v-if="saveHint" class="muted">{{ saveHint }}</span>
        </div>
        <div class="exam-nav-row">
          <div class="exam-nums">
            <router-link
              v-for="(p, i) in paper.problems"
              :key="p.id"
              :to="paperHref(p.id)"
              class="exam-num"
              :class="chipClass(p)"
              active-class="exam-num-active"
              exact-active-class="exam-num-active"
              :title="chipTitle(p)"
            >{{ i + 1 }}</router-link>
          </div>
          <div class="exam-step">
            <button class="btn-ghost" type="button" :disabled="!prevProblem" @click="goNeighbor(prevProblem)">上一题</button>
            <button class="btn-ghost" type="button" :disabled="!nextProblem" @click="goNeighbor(nextProblem)">下一题</button>
          </div>
        </div>
        <p class="exam-legend muted">题号：当前为靛蓝框；满分绿色；已做褐色；已作答浅底。换题用上面的题号或上一题/下一题。作答会自动保存。</p>
      </nav>
      <span class="mono indigo">{{ problem.code }}</span>
      <h1 class="serif" style="display:inline;margin-left:0.5rem;font-size:1.4rem">{{ problem.title }}</h1>
      <span v-if="session.user?.role === 'coach' && !problem.has_answer" class="tag-warn">无答案</span>
      <p v-if="problem.published === 0" class="muted">未发布，仅教练可见。</p>
      <div class="muted" v-if="problem.type === 'traditional'">
        {{ problem.time_ms }} ms · {{ problem.memory_mb }} MB · {{ problem.io_mode === 'stdin' ? '标准输入输出' : problem.io_mode }}
      </div>
    </div>
    <div class="solve">
      <div class="solve-stem">
        <div class="stem-wrap">
          <StatementView :text="problem.statement" />
        </div>
        <template v-if="problem.sample_in">
          <h3>样例</h3>
          <div class="pre">{{ problem.sample_in }}</div>
          <div class="pre">{{ problem.sample_out }}</div>
          <p v-if="problem.sample_note" class="muted">{{ problem.sample_note }}</p>
        </template>
        <template v-if="problem.subtasks?.length">
          <h3>测试点</h3>
          <table class="table">
            <thead>
              <tr><th>编号</th><th>分值</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in problem.subtasks" :key="t.seq"><td class="mono">{{ t.seq }}</td><td>{{ t.score }}</td></tr>
            </tbody>
          </table>
        </template>
      </div>
      <div class="solve-answer">
        <h3 class="solve-answer-head">作答</h3>
        <p v-if="!paper && saveHint" class="muted">{{ saveHint }}</p>
        <template v-if="problem.type === 'choice'">
          <label v-for="opt in problem.choice?.options || []" :key="opt.key" class="choice-opt">
            <input type="radio" :value="opt.key" v-model="choice" />
            <span class="choice-body">
              <span class="choice-key">{{ opt.key }}.</span>
              <StatementView v-if="optionBody(opt)" class="choice-rich" :text="optionBody(opt)" />
            </span>
          </label>
          <p v-if="!(problem.choice?.options || []).length" class="muted">本题选项不完整，仍可保存作答。</p>
        </template>
        <template v-else>
          <label class="field">语言
            <select v-model="lang">
              <option v-for="l in problem.languages" :key="l" :value="l">{{ l === 'cpp' ? 'C++' : 'Python' }}</option>
            </select>
          </label>
          <CodeEditor v-model="code" :language="lang" />
          <div class="solve-bar">
            <button class="btn-ghost" type="button" :disabled="!problem.sample_in" @click="send('sample')">运行样例</button>
          </div>
        </template>
        <p v-if="!problem.has_answer" class="muted">
          {{ problem.type === 'traditional' ? '本题还没有满分程序。作答会记下，但不评分。' : '本题还没有标准答案。作答会记下，但不评分。' }}
        </p>
        <p v-if="err" class="err">{{ err }}</p>
        <p v-if="waiting" class="muted">{{ waiting }}</p>
        <p v-if="unofficial" class="muted">非正式分。仅跑了公开样例。</p>
        <div v-if="result">
          <p>
            结果：{{ resultLabel() }}
            <span v-if="result.score != null && result.status !== 'submitted'"> · {{ result.score }} 分</span>
          </p>
          <p v-if="paper && !nextProblem" class="muted">
            <router-link :to="`/problems/papers/${paper.id}`">本卷最后一题，返回试卷</router-link>
          </p>
          <p v-if="result.result?.error" class="pre">{{ result.result.error }}</p>
          <table v-if="result.result?.cases?.length && result.status !== 'submitted'" class="table">
            <thead>
              <tr><th>点</th><th>结果</th><th>分</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in result.result.cases" :key="c.seq">
                <td class="mono">{{ c.seq }}</td>
                <td :class="c.result === 'AC' ? 'ok' : 'bad'">{{ c.result }} {{ explain(c.result) }}</td>
                <td>{{ c.score }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else-if="paper && !nextProblem" class="muted">
          <router-link :to="`/problems/papers/${paper.id}`">本卷最后一题，返回试卷</router-link>
        </p>
      </div>
    </div>
  </div>
  </template>
</template>
