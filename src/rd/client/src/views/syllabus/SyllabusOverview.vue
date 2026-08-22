<script setup>
import { computed, ref, watch } from "vue";
import SyllabusNav from "./SyllabusNav.vue";
import { useSyllabus, importanceStars, examFlag } from "./useSyllabus.js";

const PAGE_SIZE = 8;

const { cms, err, loading, track, item, tracks, setTrack } = useSyllabus();
const topicPage = ref(1);

const topics = computed(() => item.value?.topics || []);
const topicPages = computed(() => Math.max(1, Math.ceil(topics.value.length / PAGE_SIZE)));
const pagedTopics = computed(() => {
  const start = (topicPage.value - 1) * PAGE_SIZE;
  return topics.value.slice(start, start + PAGE_SIZE);
});

function shortTrackTitle(title) {
  return String(title || "")
    .replace(/\s*入门级$/, "")
    .replace(/\s*提高级$/, "")
    .replace(/\s*1–8 级$/, "");
}

watch(track, () => {
  topicPage.value = 1;
});
watch(topicPages, (n) => {
  if (topicPage.value > n) topicPage.value = n;
  if (topicPage.value < 1) topicPage.value = 1;
});
</script>

<template>
  <article class="read wide syll-page">
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="loading" class="muted">载入中</p>
    <template v-else-if="cms && item">
      <SyllabusNav
        :tracks="tracks"
        :track="track"
        :compact="true"
        :label-fn="shortTrackTitle"
        @pick="setTrack"
      />

      <section class="syll-panel">
        <div class="syll-panel-head">
          <h2 class="serif">{{ shortTrackTitle(item.title) }}</h2>
          <p v-if="item.blurb" class="muted syll-blurb">{{ item.blurb }}</p>
        </div>

        <template v-if="item.round_compare?.length">
          <h3 class="syll-section-title">初赛 vs 复赛</h3>
          <table class="table desk syll-table syll-table-compact">
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

        <template v-if="topics.length">
          <div class="syll-section-bar">
            <h3 class="syll-section-title">知识体系</h3>
            <p v-if="topicPages > 1" class="muted syll-page-sum">{{ topicPage }}/{{ topicPages }} · 共 {{ topics.length }}</p>
          </div>
          <table class="table desk syll-table syll-table-compact">
            <thead>
              <tr><th>类别</th><th>知识点</th><th>初赛</th><th>复赛</th><th>重要度</th></tr>
            </thead>
            <tbody>
              <tr v-for="(topic, i) in pagedTopics" :key="(topicPage - 1) * PAGE_SIZE + i">
                <td><strong>{{ topic.title }}</strong></td>
                <td class="muted">{{ (topic.points || []).join("；") }}</td>
                <td class="mono">{{ examFlag(topic.preliminary) }}</td>
                <td class="mono">{{ examFlag(topic.finals) }}</td>
                <td class="syll-stars">{{ importanceStars(topic.importance) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="mobile syll-cards">
            <div v-for="(topic, i) in pagedTopics" :key="(topicPage - 1) * PAGE_SIZE + i" class="syll-card">
              <strong>{{ topic.title }}</strong>
              <p class="muted">{{ (topic.points || []).join("；") }}</p>
              <p class="muted mono">
                初赛 {{ examFlag(topic.preliminary) }}
                · 复赛 {{ examFlag(topic.finals) }}
                · {{ importanceStars(topic.importance) }}
              </p>
            </div>
          </div>
          <p v-if="topicPages > 1" class="syll-pager">
            <button class="btn-ghost" type="button" :disabled="topicPage <= 1" @click="topicPage -= 1">上一页</button>
            <span class="muted">{{ topicPage }} / {{ topicPages }}</span>
            <button class="btn-ghost" type="button" :disabled="topicPage >= topicPages" @click="topicPage += 1">下一页</button>
          </p>
        </template>

        <template v-if="item.slug === 'csp-j' && cms.csp_compare?.length">
          <h3 class="syll-section-title">CSP-J vs CSP-S</h3>
          <table class="table desk syll-table syll-table-compact">
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
      </section>
    </template>
  </article>
</template>
