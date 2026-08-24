<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "../api.js";

const DEFAULT_HERO_PITCH = "编程按官方赛道练。先定级别，再本周开练。";

const STAR_S_LABELS = ["国家政策", "一线在做什么", "未来趋势", "我们该怎么做"];

const cms = ref(null);
const err = ref("");

const careerLayers = [
  { layer: "L1", title: "表达", body: "把问题说成机器可执行的步骤" },
  { layer: "L2", title: "算法", body: "正确、够快、可验证——信奥主战场" },
  { layer: "L3", title: "工程", body: "系统、可靠、可协作——工作后主战场" },
  { layer: "L4", title: "架构", body: "边界与取舍——资深以后主战场" },
];

const heroPitch = computed(() => {
  const raw = String(cms.value?.hero_pitch || "").trim();
  return raw || DEFAULT_HERO_PITCH;
});

const starSBlocks = computed(() => {
  const raw = String(cms.value?.star_s || "").trim();
  if (!raw) return [];
  return raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
});

const starTBlocks = computed(() => {
  const raw = String(cms.value?.star_t || "").trim();
  if (!raw) return [];
  return raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
});

const starRBlocks = computed(() => {
  const raw = String(cms.value?.star_r || "").trim();
  if (!raw) return [];
  return raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
});

const caseStudies = computed(() => cms.value?.case_studies || []);
const timeline = computed(() => cms.value?.timeline || []);

function shortTrackTitle(title) {
  return String(title || "")
    .replace(/\s*入门级$/, "")
    .replace(/\s*提高级$/, "")
    .replace(/\s*1–8 级$/, "");
}

function starSLabel(i) {
  return STAR_S_LABELS[i] || null;
}

onMounted(async () => {
  try {
    cms.value = await api("/api/cms?scope=home");
  } catch (e) {
    err.value = e.message;
  }
});
</script>

<template>
  <article class="read home-page">
    <header class="home-hero">
      <div class="home-hero-brand">
        <h1 class="serif">EduHub</h1>
        <p class="home-hero-tag">信息学奥林匹克训练</p>
      </div>
      <p class="home-hero-pitch">{{ heroPitch }}</p>
      <nav class="home-hero-cta" aria-label="开始">
        <router-link class="btn" to="/syllabus">打开大纲，选定赛道</router-link>
      </nav>
    </header>

    <p v-if="err" class="err">{{ err }}</p>
    <template v-if="cms">
      <section class="home-section">
        <header class="home-sec-head">
          <span class="home-sec-num" aria-hidden="true">一</span>
          <div class="home-sec-titles">
            <h2 class="serif">场景与任务</h2>
            <p class="home-sec-lead">大环境与我们该做的事。</p>
          </div>
        </header>
        <div class="home-sec-body">
          <template v-if="starSBlocks.length">
            <div v-for="(block, i) in starSBlocks" :key="'s' + i" class="home-star-block">
              <div v-if="starSLabel(i)" class="home-star-label">{{ starSLabel(i) }}</div>
              <p class="home-benefit">{{ block }}</p>
              <p v-if="i === 0" class="home-policy-link">
                <router-link to="/news/policy">国家政策全文与出处</router-link>
              </p>
              <p v-else-if="i === 1" class="home-policy-link">
                <router-link to="/news/contests">公开赛与一线活动</router-link>
              </p>
            </div>
          </template>

          <ul v-if="caseStudies.length" class="home-cases">
            <li v-for="(item, i) in caseStudies" :key="i" class="home-case">
              <span class="home-case-lens">{{ item.lens }}</span>
              <div class="home-case-main">
                <div class="home-case-title">{{ item.title }}</div>
                <p class="home-case-body">{{ item.body }}</p>
              </div>
            </li>
          </ul>

          <div v-if="starTBlocks.length" class="home-star-task">
            <h3 class="home-star-task-title serif">我们的任务：对齐 GESP 等官方赛道</h3>
            <p
              v-for="(block, i) in starTBlocks"
              :key="'t' + i"
              class="home-benefit"
              :class="{ 'is-note': i > 0 }"
            >{{ block }}</p>
          </div>
        </div>
      </section>

      <section class="home-section">
        <header class="home-sec-head">
          <span class="home-sec-num" aria-hidden="true">二</span>
          <div class="home-sec-titles">
            <h2 class="serif">从哪练、何时练</h2>
            <p class="home-sec-lead">行动：路径与考期。</p>
          </div>
        </header>
        <div class="home-sec-body">
          <div v-if="cms.syllabus?.length" class="home-path" aria-label="官方赛道">
            <template v-for="(item, i) in cms.syllabus" :key="item.slug">
              <span v-if="i" class="home-path-arrow" aria-hidden="true">→</span>
              <router-link
                class="home-path-node"
                :to="{ path: '/syllabus', query: { track: item.slug } }"
              >{{ shortTrackTitle(item.title) }}</router-link>
            </template>
          </div>

          <div class="home-tracks">
            <router-link
              v-for="item in cms.syllabus"
              :key="item.slug"
              class="home-track"
              :to="{ path: '/syllabus', query: { track: item.slug } }"
            >
              <div class="home-track-main">
                <span class="home-track-title">{{ shortTrackTitle(item.title) }}</span>
                <span class="home-track-desc">{{ item.blurb }}</span>
              </div>
              <span class="home-track-go" aria-hidden="true">→</span>
            </router-link>
          </div>

          <p class="home-aside">小一步：点进一条赛道，只定「本周只做这一级」。</p>

          <div v-if="timeline.length" class="home-timeline" role="list">
            <div v-for="(row, i) in timeline" :key="i" class="home-tl-row" role="listitem">
              <div class="home-tl-when mono">{{ row.month_label }}</div>
              <div class="home-tl-what">
                <div class="home-tl-title">{{ row.title }}</div>
                <div class="home-tl-prep">{{ row.prep }}</div>
              </div>
            </div>
          </div>
          <p v-if="timeline.length" class="home-footnote muted">具体日期以 CCF / GESP 官网为准。</p>
        </div>
      </section>

      <section class="home-section home-close">
        <header class="home-sec-head">
          <span class="home-sec-num" aria-hidden="true">三</span>
          <div class="home-sec-titles">
            <h2 class="serif">下一步与收获</h2>
            <p class="home-sec-lead">行动收束 · 能收获什么。</p>
          </div>
        </header>
        <div class="home-sec-body">
          <div class="home-close-actions">
            <router-link class="btn" to="/syllabus">打开大纲，选本周级别</router-link>
            <router-link class="btn-ghost" to="/problems">进题库，按卷开练</router-link>
            <router-link class="btn-ghost" to="/progress">登录后查看训练榜单</router-link>
            <a
              class="btn-ghost"
              href="https://about.jsoner.cn/"
              target="_blank"
              rel="noopener noreferrer"
            >了解讲师</a>
          </div>

          <template v-if="starRBlocks.length">
            <p
              v-for="(block, i) in starRBlocks"
              :key="'r' + i"
              class="home-benefit"
              :class="{ 'is-note': i > 0 }"
            >{{ block }}</p>
          </template>

          <ol class="home-ladder">
            <li v-for="row in careerLayers" :key="row.layer" class="home-ladder-row">
              <span class="home-ladder-layer mono">{{ row.layer }}</span>
              <div class="home-ladder-main">
                <div class="home-ladder-title">{{ row.title }}</div>
                <p class="home-ladder-body">{{ row.body }}</p>
              </div>
            </li>
          </ol>

          <p class="home-aside">
            登录后可对照
            <router-link to="/progress">训练榜单</router-link>
            ，看全员练到哪一级。
          </p>
        </div>
      </section>
    </template>
    <p v-else-if="!err" class="muted">载入中</p>
  </article>
</template>
