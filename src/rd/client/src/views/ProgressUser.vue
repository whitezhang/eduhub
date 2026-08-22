<script setup>
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api.js";
import { useProtectedLoad } from "../composables/useAuthWall.js";
import AuthWallSkeleton from "../components/AuthWallSkeleton.vue";
import { useSession } from "../stores/session.js";

const PAGE_SIZE = 15;

const route = useRoute();
const session = useSession();
const data = ref(null);
const page = ref(1);
const loading = ref(true);
const err = ref("");

async function load() {
  loading.value = true;
  err.value = "";
  data.value = null;
  page.value = 1;
  try {
    data.value = await api(`/api/progress/${route.params.id}`);
  } catch (e) {
    err.value = e.message;
  } finally {
    loading.value = false;
  }
}

const { locked } = useProtectedLoad(load);

const problems = computed(() => data.value?.problems || []);
const totalPages = computed(() => Math.max(1, Math.ceil(problems.value.length / PAGE_SIZE)));
const paged = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return problems.value.slice(start, start + PAGE_SIZE);
});

function cell(p) {
  if (p.score == null) return "—";
  return String(p.score);
}

watch(() => route.params.id, () => {
  if (!session.user) return;
  load();
});
watch(totalPages, (n) => {
  if (page.value > n) page.value = n;
  if (page.value < 1) page.value = 1;
});
</script>

<template>
  <AuthWallSkeleton v-if="locked" variant="progress" />
  <div v-else class="wide progress-user-page">
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="loading" class="muted">载入中</p>
    <template v-else-if="data">
      <header class="page-head">
        <h1 class="serif">{{ data.user.display_name }}</h1>
        <p class="muted page-sum">@{{ data.user.username }}</p>
      </header>
      <table v-if="paged.length" class="table desk">
        <thead>
          <tr>
            <th>题号</th>
            <th>题目</th>
            <th>得分</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in paged" :key="p.id">
            <td class="mono">{{ p.code }}</td>
            <td>{{ p.title }}</td>
            <td class="mono">{{ cell(p) }} / {{ p.full_score }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="totalPages > 1" class="page-pager">
        <button class="btn-ghost" type="button" :disabled="page <= 1" @click="page -= 1">上一页</button>
        <span class="muted">{{ page }} / {{ totalPages }}</span>
        <button class="btn-ghost" type="button" :disabled="page >= totalPages" @click="page += 1">下一页</button>
      </p>
    </template>
  </div>
</template>
