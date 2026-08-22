<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api.js";

const PAGE_SIZE = 12;

const students = ref([]);
const q = ref("");
const page = ref(1);
const loading = ref(true);
const err = ref("");

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

onMounted(async () => {
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
});

watch(q, () => {
  page.value = 1;
});
watch(totalPages, (n) => {
  if (page.value > n) page.value = n;
  if (page.value < 1) page.value = 1;
});
</script>

<template>
  <div class="wide progress-page">
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
        <input v-model="q" class="search search-fill" placeholder="搜索用户或最近比赛" type="search" autocomplete="off" />
        <button v-if="q" class="search-clear" type="button" aria-label="清除" @click="clearSearch">×</button>
      </div>
    </div>
    <p v-if="loading" class="muted">载入中</p>
    <template v-else-if="paged.length">
      <table class="table desk progress-table">
        <thead>
          <tr><th>用户</th><th>题库（满分/部分/未做）</th><th>最近比赛</th><th>最近提交</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in paged" :key="s.id">
            <td><router-link :to="`/progress/${s.id}`">{{ s.display_name }}</router-link></td>
            <td>{{ s.full }} / {{ s.part }} / {{ s.untouched }}</td>
            <td>{{ s.last_contest }}</td>
            <td>{{ s.last_submit || "—" }}</td>
          </tr>
        </tbody>
      </table>
      <div class="mobile">
        <router-link v-for="s in paged" :key="s.id" class="progress-card" :to="`/progress/${s.id}`">
          <div>{{ s.display_name }}</div>
          <div class="muted">满分 {{ s.full }} · 部分 {{ s.part }} · 未做 {{ s.untouched }}</div>
          <div class="muted">{{ s.last_contest }}</div>
        </router-link>
      </div>
      <p v-if="totalPages > 1" class="page-pager">
        <button class="btn-ghost" type="button" :disabled="page <= 1" @click="page -= 1">上一页</button>
        <span class="muted">{{ page }} / {{ totalPages }}</span>
        <button class="btn-ghost" type="button" :disabled="page >= totalPages" @click="page += 1">下一页</button>
      </p>
    </template>
    <p v-else class="muted">
      <template v-if="q.trim() && students.length">没有匹配「{{ q.trim() }}」的用户。</template>
      <template v-else>暂无榜单数据。</template>
    </p>
  </div>
</template>
