<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { readLocalPaper } from "../paper-save.js";
import { useSession } from "../stores/session.js";

const route = useRoute();
const router = useRouter();
const session = useSession();
const contest = ref(null);
const board = ref(null);
const err = ref("");
const now = ref(Date.now());
let clock = null;

onMounted(async () => {
  try {
    contest.value = await api(`/api/contests/${route.params.id}`);
    board.value = await api(`/api/contests/${route.params.id}/board`);
  } catch (e) {
    err.value = e.message;
  }
  clock = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => clearInterval(clock));

const remain = computed(() => {
  if (!contest.value) return "";
  const end = new Date(contest.value.end_at).getTime();
  const s = Math.max(0, Math.floor((end - now.value) / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
});

const resumeId = computed(() => {
  const c = contest.value;
  if (!c?.problems?.length) return null;
  const local = readLocalPaper(session.user, c.id);
  const last = c.last_problem_id || local.last_problem_id;
  if (last && c.problems.some((p) => p.id === last)) return last;
  const unfinished = c.problems.find((p) => p.my_score == null);
  return (unfinished || c.problems[0]).id;
});

const hasProgress = computed(() => {
  const c = contest.value;
  if (!c?.problems) return false;
  const local = readLocalPaper(session.user, c.id);
  return c.problems.some((p) => p.my_score != null || p.has_draft) || Boolean(local.last_problem_id);
});

function ruleName(r) {
  return { practice: "练习", oi: "OI", ioi: "IOI" }[r] || r;
}

function scoreText(p) {
  if (p.my_score == null) return p.has_draft ? "草稿" : "未做";
  if (p.my_score >= p.full_score) return `${p.my_score}`;
  return `${p.my_score}`;
}

function problemHref(pid) {
  return { path: `/problems/${pid}`, query: { contest: String(contest.value.id) } };
}

async function openProblem(pid) {
  if (session.user) {
    try {
      await enter();
    } catch (e) {
      err.value = e.message;
      return;
    }
  }
  router.push(problemHref(pid));
}

async function enter() {
  if (!session.user) {
    session.openLogin();
    return;
  }
  if (!contest.value.registered) {
    await api(`/api/contests/${contest.value.id}/register`, { method: "POST", body: {} });
    contest.value.registered = true;
  }
}

async function startOrContinue() {
  await enter();
  if (!session.user || !resumeId.value) return;
  router.push(problemHref(resumeId.value));
}
</script>

<template>
  <div class="wide" v-if="contest">
    <h1 class="serif">{{ contest.title }}</h1>
    <p class="muted">{{ ruleName(contest.rule) }} · 剩余 <span class="mono">{{ remain }}</span></p>
    <p v-if="err" class="err">{{ err }}</p>
    <p>
      <button class="btn" type="button" @click="startOrContinue">{{ hasProgress ? "继续做题" : "开始做题" }}</button>
    </p>
    <h2>题目</h2>
    <table class="table desk">
      <thead><tr><th>序号</th><th>题号</th><th>标题</th><th>成绩</th></tr></thead>
      <tbody>
        <tr v-for="(p, i) in contest.problems" :key="p.id">
          <td class="mono">{{ i + 1 }}</td>
          <td class="mono"><a href="#" @click.prevent="openProblem(p.id)">{{ p.code }}</a></td>
          <td><a href="#" @click.prevent="openProblem(p.id)">{{ p.title }}</a></td>
          <td :class="p.my_score == null ? 'muted' : p.my_score >= p.full_score ? 'ok' : 'mid'">{{ scoreText(p) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="mobile">
      <a v-for="(p, i) in contest.problems" :key="p.id" class="card" href="#" style="display:block;text-decoration:none;color:inherit" @click.prevent="openProblem(p.id)">
        <div>{{ i + 1 }}. <span class="mono">{{ p.code }}</span> {{ p.title }}</div>
        <div class="muted">{{ scoreText(p) }}</div>
      </a>
    </div>
    <h2>榜单</h2>
    <p v-if="board?.hidden" class="muted">OI 赛制进行中不公布明细。</p>
    <table v-else class="table">
      <thead>
        <tr>
          <th>名次</th><th>学生</th><th>总分</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in board?.rows || []" :key="row.user.id">
          <td>{{ i + 1 }}</td>
          <td>{{ row.user.display_name }}</td>
          <td>{{ row.total }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
