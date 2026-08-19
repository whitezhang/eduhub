<script setup>
import SyllabusNav from "./SyllabusNav.vue";
import { useSyllabus, importanceStars, examFlag } from "./useSyllabus.js";

const { cms, err, loading, track, item, tracks, setTrack } = useSyllabus();
</script>

<template>
  <article class="read wide">
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="loading" class="muted">载入中</p>
    <template v-else-if="cms && item">
      <SyllabusNav :tracks="tracks" :track="track" @pick="setTrack" />

      <section class="syll-panel">
        <div class="syll-panel-head">
          <h2 class="serif">{{ item.title }} · 大纲总览</h2>
          <router-link class="muted" :to="{ path: '/problems', query: { source: item.slug } }">进入题单 →</router-link>
        </div>
        <p class="muted">{{ item.blurb }}</p>

        <template v-if="item.round_compare?.length">
          <h3 class="syll-section-title">初赛 vs 复赛</h3>
          <table class="table desk syll-table">
            <thead>
              <tr><th>维度</th><th>初赛（第一轮）</th><th>复赛（第二轮）</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in item.round_compare" :key="i">
                <td>{{ row.label }}</td>
                <td>{{ row.preliminary }}</td>
                <td>{{ row.finals }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-if="item.topics?.length">
          <h3 class="syll-section-title">知识体系</h3>
          <table class="table desk syll-table">
            <thead>
              <tr><th>类别</th><th>知识点</th><th>初赛</th><th>复赛</th><th>重要度</th></tr>
            </thead>
            <tbody>
              <tr v-for="(topic, i) in item.topics" :key="i">
                <td><strong>{{ topic.title }}</strong></td>
                <td class="muted">{{ (topic.points || []).join("；") }}</td>
                <td class="mono">{{ examFlag(topic.preliminary) }}</td>
                <td class="mono">{{ examFlag(topic.finals) }}</td>
                <td class="syll-stars">{{ importanceStars(topic.importance) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="mobile syll-cards">
            <div v-for="(topic, i) in item.topics" :key="i" class="syll-card">
              <strong>{{ topic.title }}</strong>
              <p class="muted">{{ (topic.points || []).join("；") }}</p>
              <p class="muted mono">
                初赛 {{ examFlag(topic.preliminary) }}
                · 复赛 {{ examFlag(topic.finals) }}
                · {{ importanceStars(topic.importance) }}
              </p>
            </div>
          </div>
        </template>

        <template v-if="item.slug === 'csp-j' && cms.csp_compare?.length">
          <h3 class="syll-section-title">CSP-J vs CSP-S</h3>
          <table class="table desk syll-table">
            <thead>
              <tr><th>维度</th><th>CSP-J 入门组</th><th>CSP-S 提高组</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in cms.csp_compare" :key="i">
                <td>{{ row.label }}</td>
                <td>{{ row.j }}</td>
                <td>{{ row.s }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <p class="syll-next">
          <router-link :to="{ path: '/syllabus/guide', query: { track } }">查看知识点详解 →</router-link>
        </p>
      </section>
    </template>
  </article>
</template>
