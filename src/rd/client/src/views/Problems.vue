<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { useSession } from "../stores/session.js";
import { useProtectedLoad } from "../composables/useAuthWall.js";
import AuthWallSkeleton from "../components/AuthWallSkeleton.vue";

const PAGE_SIZE = 12;

const route = useRoute();
const router = useRouter();
const session = useSession();
const lists = ref([]);
const papers = ref([]);
const q = ref("");
const err = ref("");
const noAnswerCount = ref(0);
const loading = ref(false);
const page = ref(1);
let loadSeq = 0;

const source = computed(() => String(route.query.source || ""));

const sourceNote = computed(() => {
  if (source.value === "gesp") {
    return "GESP 选择/判断来自 AdaCpp；编程题来自 CCF 官方 PDF。";
  }
  if (source.value === "csp-j") {
    return "CSP-J 专题练习来自 AdaCpp。";
  }
  return "";
});

function parsePaperQuery(raw) {
  const needle = raw.trim().toLowerCase();
  const wantNoAnswer = needle.includes("无答案");
  const titlePart = needle.replace(/无答案/g, "").trim();
  return { wantNoAnswer, titlePart };
}

const parsedPaperQuery = computed(() => parsePaperQuery(q.value));

const filteredPapers = computed(() => {
  const { wantNoAnswer, titlePart } = parsedPaperQuery.value;
  if (!wantNoAnswer && !titlePart) return papers.value;
  return papers.value.filter((c) => {
    if (wantNoAnswer) {
      if (session.user?.role !== "coach" || !(c.missing_answer_count > 0)) return false;
    }
    if (titlePart && !String(c.title || "").toLowerCase().includes(titlePart)) return false;
    return true;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredPapers.value.length / PAGE_SIZE)));

const pagedPapers = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filteredPapers.value.slice(start, start + PAGE_SIZE);
});

async function load() {
  const seq = ++loadSeq;
  const src = source.value;
  err.value = "";
  loading.value = true;
  papers.value = [];
  page.value = 1;
  try {
    const [l, c] = await Promise.all([
      api("/api/problem-lists"),
      api(`/api/contests?source=${encodeURIComponent(src)}`),
    ]);
    if (seq !== loadSeq) return;
    lists.value = l.lists;
    papers.value = c.contests || [];
    noAnswerCount.value = 0;
    if (session.user?.role === "coach") {
      const studio = await api("/api/studio/problems");
      if (seq !== loadSeq) return;
      noAnswerCount.value = (studio.problems || []).filter((x) => !x.has_answer).length;
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    err.value = e.message;
    papers.value = [];
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

const { locked } = useProtectedLoad(load);

function goSource(slug) {
  q.value = "";
  page.value = 1;
  router.push({ path: "/problems", query: slug ? { source: slug } : {} });
}

function clearSearch() {
  q.value = "";
}

function scoreHint(c) {
  const n = c.problem_count || 0;
  if (!n) return "暂无题目";
  if (c.full_count) return `满分 ${c.full_count} / ${n}`;
  if (c.done_count) return `已做 ${c.done_count} / ${n}`;
  return `${n} 题`;
}

function clampPage() {
  if (page.value > totalPages.value) page.value = totalPages.value;
  if (page.value < 1) page.value = 1;
}

watch(
  () => route.query.source,
  () => {
    if (!session.user) return;
    q.value = "";
    page.value = 1;
    load();
  },
);
watch(() => session.user?.role, () => {
  if (session.user) load();
});
watch(q, () => {
  page.value = 1;
});
watch(totalPages, clampPage);
</script>

<template>
  <AuthWallSkeleton v-if="locked" variant="problems" />
  <div v-else class="wide problems-page">
    <div class="problems-head">
      <h1 class="serif">题库</h1>
      <p v-if="sourceNote" class="muted problems-note">{{ sourceNote }}</p>
      <p v-if="noAnswerCount" class="muted problems-note">
        另有 {{ noAnswerCount }} 道无标准答案
        <router-link to="/studio">去管理</router-link>
      </p>
      <p v-if="err" class="err">{{ err }}</p>
    </div>
    <div class="chips">
      <a href="#" :class="{ on: !source }" @click.prevent="goSource('')">全部</a>
      <a
        v-for="l in lists"
        :key="l.slug"
        href="#"
        :class="{ on: source === l.source }"
        @click.prevent="goSource(l.source)"
      >{{ l.title }}</a>
    </div>
    <div class="problems-layout">
      <aside class="side">
        <a href="#" :class="{ on: !source }" @click.prevent="goSource('')">全部</a>
        <a
          v-for="l in lists"
          :key="l.id"
          href="#"
          :class="{ on: source === l.source }"
          @click.prevent="goSource(l.source)"
        >{{ l.title }}</a>
      </aside>
      <div class="problems-main">
        <div class="problems-toolbar">
          <div class="search-wrap">
            <input v-model="q" class="search search-fill" placeholder="搜索试卷名，或输入「无答案」" type="search" autocomplete="off" />
            <button v-if="q" class="search-clear" type="button" aria-label="清除" @click="clearSearch">×</button>
          </div>
          <p v-if="loading" class="muted problem-bank-sum">载入中</p>
          <p v-else-if="filteredPapers.length" class="muted problem-bank-sum">
            <template v-if="q.trim()">筛选 {{ filteredPapers.length }} / {{ papers.length }} 套</template>
            <template v-else>共 {{ papers.length }} 套</template>
            <template v-if="totalPages > 1"> · {{ page }}/{{ totalPages }}</template>
          </p>
        </div>
        <table v-if="pagedPapers.length" class="table desk problems-table">
          <thead>
            <tr>
              <th>试卷</th>
              <th>题数</th>
              <th>进度</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in pagedPapers" :key="c.id">
              <td>
                {{ c.title }}
                <span v-if="session.user?.role === 'coach' && c.missing_answer_count" class="tag-warn">无答案 {{ c.missing_answer_count }}</span>
              </td>
              <td class="mono">{{ c.problem_count }}</td>
              <td class="muted">{{ scoreHint(c) }}</td>
              <td>
                <router-link :to="{ path: `/problems/papers/${c.id}`, query: source ? { source } : {} }">进入</router-link>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="!loading" class="muted">
          <template v-if="parsedPaperQuery.wantNoAnswer && !parsedPaperQuery.titlePart && papers.length">
            <template v-if="session.user?.role === 'coach'">没有缺答案的试卷。</template>
            <template v-else>「无答案」筛选仅教练可见。</template>
          </template>
          <template v-else-if="q.trim() && papers.length">没有符合筛选条件的试卷。</template>
          <template v-else>本题单暂无试卷。</template>
        </p>
        <div class="mobile">
          <router-link
            v-for="c in pagedPapers"
            :key="c.id"
            class="problem-card"
            :to="{ path: `/problems/papers/${c.id}`, query: source ? { source } : {} }"
          >
            <span class="muted mono">{{ c.problem_count }}</span>
            <span>
              {{ c.title }}
              <span v-if="session.user?.role === 'coach' && c.missing_answer_count" class="tag-warn">无答案 {{ c.missing_answer_count }}</span>
            </span>
            <span class="muted">{{ scoreHint(c) }}</span>
          </router-link>
        </div>
        <p v-if="totalPages > 1" class="problems-pager">
          <button class="btn-ghost" type="button" :disabled="page <= 1" @click="page -= 1">上一页</button>
          <span class="muted">{{ page }} / {{ totalPages }}</span>
          <button class="btn-ghost" type="button" :disabled="page >= totalPages" @click="page += 1">下一页</button>
        </p>
      </div>
    </div>
  </div>
</template>
