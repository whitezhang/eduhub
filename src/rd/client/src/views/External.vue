<script setup>
import { onMounted, ref } from "vue";
import { api } from "../api.js";

const events = ref([]);
onMounted(async () => {
  events.value = (await api("/api/external")).events;
});
</script>

<template>
  <div class="read">
    <h1 class="serif">外部资料</h1>
    <div class="timeline" style="margin-top:2rem">
      <template v-for="e in events" :key="e.id">
        <div class="mono muted">{{ e.month_label }}</div>
        <div>
          <div>{{ e.title }}</div>
          <div class="muted">{{ e.audience }} · {{ e.prep }}</div>
          <p>
            <a :href="e.official_url" target="_blank" rel="noreferrer">{{ e.official_label }}</a>
            <router-link v-if="e.problem_list_slug" :to="`/problems?source=${e.problem_list_slug}`" style="margin-left:1rem">看题</router-link>
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
