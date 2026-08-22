<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api.js";

const PAGE_SIZE = 8;

const events = ref([]);
const q = ref("");
const page = ref(1);
const loading = ref(true);
const err = ref("");

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return events.value;
  return events.value.filter((e) => {
    const hay = `${e.title || ""} ${e.audience || ""} ${e.prep || ""} ${e.month_label || ""}`.toLowerCase();
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
    events.value = (await api("/api/external")).events || [];
  } catch (e) {
    err.value = e.message;
    events.value = [];
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
  <div class="read external-page">
    <header class="page-head">
      <h1 class="serif">外部资料</h1>
      <p v-if="!loading && filtered.length" class="muted page-sum">
        <template v-if="q.trim()">筛选 {{ filtered.length }} / {{ events.length }}</template>
        <template v-else>共 {{ events.length }} 条</template>
        <template v-if="totalPages > 1"> · {{ page }}/{{ totalPages }}</template>
      </p>
    </header>
    <p v-if="err" class="err">{{ err }}</p>
    <div class="page-toolbar">
      <div class="search-wrap">
        <input v-model="q" class="search search-fill" placeholder="搜索资料名、对象或说明" type="search" autocomplete="off" />
        <button v-if="q" class="search-clear" type="button" aria-label="清除" @click="clearSearch">×</button>
      </div>
    </div>
    <p v-if="loading" class="muted">载入中</p>
    <template v-else-if="paged.length">
      <div class="timeline timeline-compact">
        <template v-for="e in paged" :key="e.id">
          <div class="mono muted">{{ e.month_label }}</div>
          <div>
            <div>{{ e.title }}</div>
            <div class="muted">{{ e.audience }} · {{ e.prep }}</div>
            <p class="external-links">
              <a :href="e.official_url" target="_blank" rel="noreferrer">{{ e.official_label }}</a>
              <router-link v-if="e.problem_list_slug" :to="`/problems?source=${e.problem_list_slug}`">看题</router-link>
            </p>
          </div>
        </template>
      </div>
      <p v-if="totalPages > 1" class="page-pager">
        <button class="btn-ghost" type="button" :disabled="page <= 1" @click="page -= 1">上一页</button>
        <span class="muted">{{ page }} / {{ totalPages }}</span>
        <button class="btn-ghost" type="button" :disabled="page >= totalPages" @click="page += 1">下一页</button>
      </p>
    </template>
    <p v-else class="muted">
      <template v-if="q.trim() && events.length">没有匹配「{{ q.trim() }}」的资料。</template>
      <template v-else>暂无外部资料。</template>
    </p>
  </div>
</template>
