<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { useSession } from "../stores/session.js";

const route = useRoute();
const router = useRouter();
const session = useSession();
const lists = ref([]);
const papers = ref([]);
const q = ref("");
const err = ref("");
const noAnswerCount = ref(0);
const loading = ref(false);
let loadSeq = 0;

const source = computed(() => String(route.query.source || ""));

const filteredPapers = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return papers.value;
  return papers.value.filter((c) => String(c.title || "").toLowerCase().includes(needle));
});

async function load() {
  const seq = ++loadSeq;
  const src = source.value;
  err.value = "";
  loading.value = true;
  papers.value = [];
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

function goSource(slug) {
  q.value = "";
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

onMounted(load);
watch(
  () => route.query.source,
  () => {
    q.value = "";
    load();
  },
);
watch(() => session.user?.role, load);
</script>

<template>
  <div class="wide">
    <h1 class="serif">题库</h1>
    <p v-if="noAnswerCount" class="muted">
      另有 {{ noAnswerCount }} 道题目没有标准答案（学生可见，不评分）。
      <router-link to="/studio">去管理查看</router-link>
    </p>
    <p v-if="err" class="err">{{ err }}</p>
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
      <div>
        <div class="search-wrap">
          <input v-model="q" class="search search-fill" placeholder="搜索试卷名" type="search" autocomplete="off" />
          <button v-if="q" class="search-clear" type="button" aria-label="清除" @click="clearSearch">×</button>
        </div>
        <p v-if="loading" class="muted problem-bank-sum">载入中</p>
        <p v-else-if="filteredPapers.length" class="muted problem-bank-sum">
          <template v-if="q.trim()">筛选 {{ filteredPapers.length }} / {{ papers.length }} 套</template>
          <template v-else>共 {{ papers.length }} 套试卷</template>
        </p>
        <table v-if="filteredPapers.length" class="table desk">
          <thead>
            <tr>
              <th>试卷</th>
              <th>题数</th>
              <th>进度</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in filteredPapers" :key="c.id">
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
          <template v-if="q.trim() && papers.length">没有名称含「{{ q.trim() }}」的试卷。</template>
          <template v-else>本题单暂无试卷。</template>
        </p>
        <div class="mobile">
          <router-link
            v-for="c in filteredPapers"
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
      </div>
    </div>
  </div>
</template>
