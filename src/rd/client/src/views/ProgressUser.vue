<script setup>
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api.js";

const route = useRoute();
const data = ref(null);
onMounted(async () => {
  data.value = await api(`/api/progress/${route.params.id}`);
});
function cell(p) {
  if (p.score == null) return "—";
  return String(p.score);
}
</script>

<template>
  <div class="wide" v-if="data">
    <h1 class="serif">{{ data.user.display_name }}</h1>
    <table class="table">
      <thead><tr><th>题号</th><th>标题</th><th>最高分</th></tr></thead>
      <tbody>
        <tr v-for="p in data.problems" :key="p.id">
          <td class="mono">{{ p.code }}</td>
          <td>{{ p.title }}</td>
          <td :class="p.score == null ? '' : p.score >= p.full_score ? 'ok' : 'mid'">{{ cell(p) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
