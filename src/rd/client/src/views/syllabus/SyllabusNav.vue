<script setup>
import { useRoute } from "vue-router";

defineProps({
  tracks: { type: Array, default: () => [] },
  track: { type: String, default: "" },
});
const emit = defineEmits(["pick"]);
const route = useRoute();

const tabs = [
  { path: "/syllabus", label: "大纲总览" },
  { path: "/syllabus/guide", label: "知识点详解" },
];
</script>

<template>
  <header class="syll-hero">
    <h1 class="serif">教学大纲</h1>
    <p class="muted">参考 NOI 2025 大纲整理。CSP-J/S 分两轮：初赛客观题，复赛编程题。</p>
    <nav class="syll-mode" aria-label="大纲视图">
      <router-link
        v-for="tab in tabs"
        :key="tab.path"
        :to="{ path: tab.path, query: route.query }"
        :class="{ on: route.path === tab.path }"
      >{{ tab.label }}</router-link>
    </nav>
    <div class="syll-tracks" role="tablist" aria-label="赛道">
      <button
        v-for="t in tracks"
        :key="t.slug"
        type="button"
        class="syll-track"
        :class="{ on: track === t.slug }"
        @click="emit('pick', t.slug)"
      >{{ t.title }}</button>
    </div>
  </header>
</template>
