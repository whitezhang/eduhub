<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { useSession } from "../stores/session.js";

const route = useRoute();
const router = useRouter();
const session = useSession();
const lists = ref([]);
const problems = ref([]);
const q = ref("");
const err = ref("");
const noAnswerCount = ref(0);

const source = computed(() => String(route.query.source || ""));

async function load() {
  err.value = "";
  try {
    const [l, p] = await Promise.all([
      api("/api/problem-lists"),
      api(`/api/problems?source=${encodeURIComponent(source.value)}&q=${encodeURIComponent(q.value)}`),
    ]);
    lists.value = l.lists;
    problems.value = p.problems;
    noAnswerCount.value = 0;
    if (session.user?.role === "coach") {
      const studio = await api("/api/studio/problems");
      noAnswerCount.value = (studio.problems || []).filter((x) => !x.has_answer).length;
    }
  } catch (e) {
    err.value = e.message;
  }
}

function scoreText(p) {
  if (p.my_score == null) return "—";
  if (p.my_score >= p.full_score) return String(p.my_score);
  return String(p.my_score);
}

onMounted(load);
watch(() => route.query.source, load);
watch(() => session.user?.role, load);

function goSource(slug) {
  router.push({ path: "/problems", query: slug ? { source: slug } : {} });
}
</script>

<template>
  <div class="wide">
    <h1 class="serif">题库</h1>
    <p v-if="noAnswerCount" class="muted">
      另有 {{ noAnswerCount }} 道题目没有标准答案，学生看不到。
      <router-link to="/studio">去管理查看</router-link>
    </p>
    <p v-if="err" class="err">{{ err }}</p>
    <div class="chips">
      <a href="#" :class="{ on: !source }" @click.prevent="goSource('')">全部</a>
      <a v-for="l in lists" :key="l.slug" href="#" :class="{ on: source === l.source }" @click.prevent="goSource(l.source)">{{ l.title }}</a>
    </div>
    <div class="problems-layout">
      <aside class="side">
        <a href="#" :class="{ on: !source }" @click.prevent="goSource('')">全部</a>
        <a v-for="l in lists" :key="l.id" href="#" :class="{ on: source === l.source }" @click.prevent="goSource(l.source)">{{ l.title }}</a>
      </aside>
      <div>
        <div class="filter-row">
          <input v-model="q" class="search" placeholder="搜索题号或标题" @keyup.enter="load" />
          <button class="btn-ghost" type="button" @click="load">搜索</button>
        </div>
        <table class="table desk">
          <thead>
            <tr><th>状态</th><th>题号</th><th>标题</th><th>来源</th><th>分</th><th>难度</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in problems" :key="p.id">
              <td :class="p.my_score == null ? '' : p.my_score >= p.full_score ? 'ok' : 'mid'">{{ scoreText(p) }}</td>
              <td class="mono"><router-link :to="`/problems/${p.id}`">{{ p.code }}</router-link></td>
              <td><router-link :to="`/problems/${p.id}`">{{ p.title }}</router-link></td>
              <td><span class="tag">{{ p.source }}</span></td>
              <td>{{ p.full_score }}</td>
              <td>{{ p.difficulty }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!problems.length" class="muted">本题单暂无题目。</p>
        <div class="mobile">
          <router-link v-for="p in problems" :key="p.id" class="card" :to="`/problems/${p.id}`" style="display:block;text-decoration:none;color:inherit">
            <div><span class="mono">{{ p.code }}</span> {{ p.title }}</div>
            <div class="muted">{{ p.source }} · {{ scoreText(p) }} / {{ p.full_score }}</div>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
