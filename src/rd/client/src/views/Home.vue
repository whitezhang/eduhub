<script setup>
import { onMounted, ref } from "vue";
import { api } from "../api.js";

const cms = ref(null);
const err = ref("");

onMounted(async () => {
  try {
    cms.value = await api("/api/cms");
  } catch (e) {
    err.value = e.message;
  }
});
</script>

<template>
  <article class="read">
    <h1 class="serif">EduHub</h1>
    <p class="muted">信息学奥林匹克训练</p>
    <p v-if="err" class="err">{{ err }}</p>
    <template v-if="cms">
      <section class="chapter">
        <div class="chapter-head"><span class="chapter-num">一</span><h2>学习信息学的好处</h2></div>
        <div style="white-space: pre-wrap">{{ cms.benefits }}</div>
      </section>
      <section class="chapter">
        <div class="chapter-head"><span class="chapter-num">二</span><h2>教学大纲</h2></div>
        <p class="muted">按赛道查看知识体系、初复赛说明与备考要点。</p>
        <p class="filter-row">
          <router-link to="/syllabus">大纲总览</router-link>
          <router-link to="/syllabus/guide">知识点详解</router-link>
        </p>
        <router-link
          v-for="item in cms.syllabus"
          :key="item.slug"
          class="syll-row syll-row-home"
          :to="{ path: '/syllabus', query: { track: item.slug } }"
        >
          <span>
            <strong>{{ item.title }}</strong>
            <div class="muted">{{ item.blurb }}</div>
          </span>
          <span class="muted">查看 →</span>
        </router-link>
      </section>
      <section class="chapter">
        <div class="chapter-head"><span class="chapter-num">三</span><h2>学习的时间节点</h2></div>
        <p class="muted">本站不承办官方认证。日期以官网为准。</p>
        <div class="timeline">
          <template v-for="(row, i) in cms.timeline" :key="i">
            <div class="mono muted">{{ row.month_label }}</div>
            <div>
              <div>{{ row.title }}</div>
              <div class="muted">{{ row.prep }}</div>
            </div>
          </template>
        </div>
      </section>
    </template>
    <p v-else class="muted">载入中</p>
  </article>
</template>
