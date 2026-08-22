<script setup>
import { computed, ref, watch } from "vue";
import { api } from "../api.js";
import { useProtectedLoad } from "../composables/useAuthWall.js";
import AuthWallSkeleton from "../components/AuthWallSkeleton.vue";

const PAGE_SIZE = 12;

const students = ref([]);
const q = ref("");
const page = ref(1);
const loading = ref(true);
const err = ref("");

async function load() {
  loading.value = true;
  err.value = "";
  try {
    students.value = (await api("/api/progress")).students || [];
  } catch (e) {
    err.value = e.message;
    students.value = [];
  } finally {
    loading.value = false;
  }
}

const { locked } = useProtectedLoad(load);

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return students.value;
  return students.value.filter((s) => {
    const hay = `${s.display_name || ""} ${s.username || ""} ${s.last_contest || ""}`.toLowerCase();
    return hay.includes(needle);
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const paged = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filtered.value.slice(start, start + PAGE_SIZE);
});

function clearSearch() {
  q.value = "";
}

watch(q, () => {
  page.value = 1;
});
watch(totalPages, (n) => {
  if (page.value > n) page.value = n;
  if (page.value < 1) page.value = 1;
});
</script>

<template>
  <AuthWallSkeleton v-if="locked" variant="progress" />
  <div v-else class="wide progress-page">
    <header class="page-head">
      <h1 class="serif">榜单</h1>
      <p v-if="!loading && filtered.length" class="muted page-sum">
        <template v-if="q.trim()">筛选 {{ filtered.length }} / {{ students.length }}</template>
        <template v-else>共 {{ students.length }} 人</template>
        <template v-if="totalPages > 1"> · {{ page }}/{{ totalPages }}</template>
      </p>
    </header>
    <p v-if="err" class="err">{{ err }}</p>
    <div class="page-toolbar">
      <div class="search-wrap">
        <input v-model="q" class="search search-fill" placeholder="搜索姓名或用户名" type="search" autocomplete="off" />
        <button v-if="q" class="search-clear" type="button" aria-label="清除" @click="clearSearch">×</button>
      </div>
    </div>
    <p v-if="loading" class="muted">载入中</p>
    <table v-else-if="paged.length" class="table desk">
      <thead>
        <tr>
          <th>学生</th>
          <th>满分</th>
          <th>部分</th>
          <th>未做</th>
          <th>最近提交</th>
          <th>最近比赛</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in paged" :key="s.id">
          <td><router-link :to="`/progress/${s.id}`">{{ s.display_name }}</router-link></td>
          <td class="mono">{{ s.full }}</td>
          <td class="mono">{{ s.part }}</td>
          <td class="mono">{{ s.untouched }}</td>
          <td class="muted mono">{{ s.last_submit || "—" }}</td>
          <td class="muted">{{ s.last_contest }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted">
      <template v-if="q.trim() && students.length">没有匹配的学生。</template>
      <template v-else>暂无学生数据。</template>
    </p>
    <p v-if="!loading && totalPages > 1" class="page-pager">
      <button class="btn-ghost" type="button" :disabled="page <= 1" @click="page -= 1">上一页</button>
      <span class="muted">{{ page }} / {{ totalPages }}</span>
      <button class="btn-ghost" type="button" :disabled="page >= totalPages" @click="page += 1">下一页</button>
    </p>
  </div>
</template>
