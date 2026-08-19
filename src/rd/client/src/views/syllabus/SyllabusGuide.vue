<script setup>
import { reactive } from "vue";
import SyllabusNav from "./SyllabusNav.vue";
import { useSyllabus } from "./useSyllabus.js";

const { cms, err, loading, track, item, tracks, setTrack } = useSyllabus();
const open = reactive({});

function key(prefix, i) {
  return `${prefix}-${i}`;
}

function toggle(k) {
  open[k] = !open[k];
}

function isOpen(k) {
  return Boolean(open[k]);
}

function levelClass(level) {
  if (!level) return "";
  if (level.includes("必") || level.includes("高")) return "syll-lv-hot";
  if (level.includes("常") || level.includes("中")) return "syll-lv-mid";
  return "syll-lv-low";
}
</script>

<template>
  <article class="read wide">
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="loading" class="muted">载入中</p>
    <template v-else-if="cms && item">
      <SyllabusNav :tracks="tracks" :track="track" @pick="setTrack" />

      <section class="syll-panel">
        <div class="syll-panel-head">
          <h2 class="serif">{{ item.title }} · 知识点详解</h2>
          <router-link class="muted" :to="{ path: '/problems', query: { source: item.slug } }">进入题单 →</router-link>
        </div>

        <template v-if="item.guides?.length">
          <h3 class="syll-section-title">初赛题型与备考</h3>
          <article v-for="(guide, i) in item.guides" :key="i" class="syll-guide-block">
            <h4>{{ guide.title }}</h4>
            <p v-if="guide.body" class="muted">{{ guide.body }}</p>
            <div v-if="guide.sections?.length" class="syll-guide-grid">
              <div v-for="(sec, j) in guide.sections" :key="j" class="syll-guide-card">
                <span class="syll-lv" :class="levelClass(sec.level)">{{ sec.level }}</span>
                <strong>{{ sec.title }}</strong>
                <p class="muted">{{ sec.body }}</p>
              </div>
            </div>
          </article>
        </template>

        <template v-if="item.hot_topics?.length">
          <h3 class="syll-section-title">高频考点 TOP {{ item.hot_topics.length }}</h3>
          <ol class="syll-hot">
            <li v-for="(t, i) in item.hot_topics" :key="i">{{ t }}</li>
          </ol>
        </template>

        <template v-if="item.topic_details?.length">
          <h3 class="syll-section-title">分块详解</h3>
          <div class="syll-accord">
            <div v-for="(block, i) in item.topic_details" :key="i" class="syll-accord-item">
              <button
                type="button"
                class="syll-accord-btn"
                :aria-expanded="isOpen(key('d', i))"
                @click="toggle(key('d', i))"
              >
                <span>{{ block.title }}</span>
                <span v-if="block.focus" class="muted">{{ block.focus }}</span>
                <span class="syll-accord-mark">{{ isOpen(key('d', i)) ? "−" : "+" }}</span>
              </button>
              <ul v-show="isOpen(key('d', i))" class="syll-accord-body">
                <li v-for="(pt, j) in block.items" :key="j">
                  <span class="syll-lv" :class="levelClass(pt.level)">{{ pt.level }}</span>
                  {{ pt.label }}
                </li>
              </ul>
            </div>
          </div>
        </template>

        <template v-else-if="item.topics?.length">
          <h3 class="syll-section-title">分块详解</h3>
          <div class="syll-accord">
            <div v-for="(block, i) in item.topics" :key="i" class="syll-accord-item">
              <button
                type="button"
                class="syll-accord-btn"
                :aria-expanded="isOpen(key('t', i))"
                @click="toggle(key('t', i))"
              >
                <span>{{ block.title }}</span>
                <span v-if="block.focus" class="muted">{{ block.focus }}</span>
                <span class="syll-accord-mark">{{ isOpen(key('t', i)) ? "−" : "+" }}</span>
              </button>
              <ul v-show="isOpen(key('t', i))" class="syll-accord-body">
                <li v-for="(pt, j) in block.points" :key="j">{{ pt }}</li>
              </ul>
            </div>
          </div>
        </template>

        <p class="syll-next">
          <router-link :to="{ path: '/syllabus', query: { track } }">← 返回大纲总览</router-link>
        </p>
      </section>
    </template>
  </article>
</template>
