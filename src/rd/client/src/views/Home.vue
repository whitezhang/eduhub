<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "../api.js";

const TIMELINE_PAGE = 6;

const cms = ref(null);
const err = ref("");
const timelinePage = ref(1);

const timeline = computed(() => cms.value?.timeline || []);
const timelinePages = computed(() => Math.max(1, Math.ceil(timeline.value.length / TIMELINE_PAGE)));
const pagedTimeline = computed(() => {
  const start = (timelinePage.value - 1) * TIMELINE_PAGE;
  return timeline.value.slice(start, start + TIMELINE_PAGE);
});

/** Split CMS benefits into lead + note paragraphs for clearer hierarchy. */
const benefitBlocks = computed(() => {
  const raw = String(cms.value?.benefits || "").trim();
  if (!raw) return [];
  return raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
});

/** Compact career stack: OI trains the algorithmic core that careers build on. */
const careerLayers = [
  { layer: "L1", title: "表达", body: "把问题说成机器可执行的步骤" },
  { layer: "L2", title: "算法", body: "正确、够快、可验证——信奥主战场" },
  { layer: "L3", title: "工程", body: "系统、可靠、可协作——工作后主战场" },
  { layer: "L4", title: "架构", body: "边界与取舍——资深以后主战场" },
];

function shortTrackTitle(title) {
  return String(title || "")
    .replace(/\s*入门级$/, "")
    .replace(/\s*提高级$/, "")
    .replace(/\s*1–8 级$/, "");
}

onMounted(async () => {
  try {
    cms.value = await api("/api/cms");
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
      <p class="home-hero-pitch">
        不只刷题。用大厂架构师的视角，把信奥放进整条信息技术职业路径里。
      </p>
      <p class="home-hero-cred muted">
        讲师
        <router-link to="/about">whitezhang</router-link>
        · 百度 / 京东架构师（P8）· 本站开放大纲、题库与榜单，先拿再决定要不要练
      </p>
      <nav class="home-hero-cta" aria-label="开始">
        <router-link class="btn" to="/syllabus">先看大纲</router-link>
        <router-link class="btn-ghost" to="/problems">进题库</router-link>
        <router-link class="btn-ghost" to="/progress">看公开榜单</router-link>
      </nav>
    </header>

    <p v-if="err" class="err">{{ err }}</p>
    <template v-if="cms">
      <!-- 互惠：先给地图 -->
      <section class="home-section">
        <header class="home-sec-head">
          <span class="home-sec-num" aria-hidden="true">〇</span>
          <div class="home-sec-titles">
            <h2 class="serif">信奥与职业路径</h2>
            <p class="home-sec-lead">大厂技术专家视角：信息学练什么，和以后干什么怎么接。</p>
          </div>
        </header>
        <div class="home-sec-body">
          <p class="home-benefit">
            做了十年以上系统与架构后，我的结论很短：信息学练的是「把约束写成可验证程序」的能力。
            这是软件职业的底座，不是终点。没有它，工程和架构都悬空；只有它，也走不远——后面还要补系统、协作与业务判断。
          </p>
          <p class="home-benefit is-note">
            规划上：中学用信奥把 L2 打实；入职后重心移到 L3；往资深走，才是 L4。奖项是信号，能力才是可复利资产。
          </p>
          <ol class="home-ladder">
            <li v-for="row in careerLayers" :key="row.layer" class="home-ladder-row">
              <span class="home-ladder-layer mono">{{ row.layer }}</span>
              <div class="home-ladder-main">
                <div class="home-ladder-title">{{ row.title }}</div>
                <p class="home-ladder-body">{{ row.body }}</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <!-- 权威 + 现有 benefits -->
      <section class="home-section">
        <header class="home-sec-head">
          <span class="home-sec-num" aria-hidden="true">一</span>
          <div class="home-sec-titles">
            <h2 class="serif">为什么学信息学</h2>
            <p class="home-sec-lead">能力收获，以及本站能做什么、不能做什么。</p>
          </div>
        </header>
        <div class="home-sec-body">
          <p
            v-for="(block, i) in benefitBlocks"
            :key="i"
            class="home-benefit"
            :class="{ 'is-note': i > 0 }"
          >{{ block }}</p>
          <p class="home-aside">
            训练进度公开。不确定值不值得练时，先看
            <router-link to="/progress">榜单</router-link>
            里别人练到哪一级。
          </p>
        </div>
      </section>

      <!-- 承诺与一致：选赛道 -->
      <section class="home-section">
        <header class="home-sec-head">
          <span class="home-sec-num" aria-hidden="true">二</span>
          <div class="home-sec-titles">
            <h2 class="serif">从哪条赛道开始</h2>
            <p class="home-sec-lead">
              先选一条，本周只跟它。需要整卷练习再进题库。
              <router-link to="/syllabus">大纲总览</router-link>
            </p>
          </div>
        </header>
        <div class="home-sec-body home-tracks">
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
          <p class="home-aside">
            小一步：点进一条大纲，记下「本周只做这一级」——比空泛「以后要学」更容易坚持。
          </p>
        </div>
      </section>

      <!-- 稀缺：考试窗口 -->
      <section class="home-section">
        <header class="home-sec-head">
          <span class="home-sec-num" aria-hidden="true">三</span>
          <div class="home-sec-titles">
            <h2 class="serif">一年里关键节点</h2>
            <p class="home-sec-lead">
              考试窗口固定，错过只能等下一场。日期以官网为准；下列为备考节奏参考。
              <template v-if="timelinePages > 1"> · {{ timelinePage }}/{{ timelinePages }}</template>
            </p>
          </div>
        </header>
        <div class="home-sec-body">
          <aside v-if="cms.gesp_csp_bridge?.rules?.length" class="home-bridge">
            <h3 class="home-bridge-title">{{ cms.gesp_csp_bridge.title }}</h3>
            <p v-if="cms.gesp_csp_bridge.note" class="home-bridge-note">{{ cms.gesp_csp_bridge.note }}</p>
            <ul class="home-bridge-rules">
              <li v-for="(rule, i) in cms.gesp_csp_bridge.rules" :key="i">
                <div class="home-bridge-pair">
                  <span class="home-bridge-k">条件</span>
                  <span class="home-bridge-v">{{ rule.condition }}</span>
                </div>
                <div class="home-bridge-pair">
                  <span class="home-bridge-k">权益</span>
                  <span class="home-bridge-v is-benefit">{{ rule.benefit }}</span>
                </div>
              </li>
            </ul>
          </aside>

          <div class="home-timeline" role="list">
            <div
              v-for="(row, i) in pagedTimeline"
              :key="(timelinePage - 1) * TIMELINE_PAGE + i"
              class="home-tl-row"
              role="listitem"
            >
              <div class="home-tl-when mono">{{ row.month_label }}</div>
              <div class="home-tl-what">
                <div class="home-tl-title">{{ row.title }}</div>
                <div class="home-tl-prep">{{ row.prep }}</div>
              </div>
            </div>
          </div>
          <p v-if="timelinePages > 1" class="page-pager">
            <button class="btn-ghost" type="button" :disabled="timelinePage <= 1" @click="timelinePage -= 1">上一页</button>
            <span class="muted">{{ timelinePage }} / {{ timelinePages }}</span>
            <button class="btn-ghost" type="button" :disabled="timelinePage >= timelinePages" @click="timelinePage += 1">下一页</button>
          </p>
        </div>
      </section>

      <!-- 收束 CTA -->
      <section class="home-section home-close">
        <header class="home-sec-head">
          <span class="home-sec-num" aria-hidden="true">四</span>
          <div class="home-sec-titles">
            <h2 class="serif">下一步</h2>
            <p class="home-sec-lead">选路径 → 按窗口练 → 用榜单对照。需要了解讲师背景再决定。</p>
          </div>
        </header>
        <div class="home-sec-body home-close-actions">
          <router-link class="btn" to="/syllabus">选定赛道大纲</router-link>
          <router-link class="btn-ghost" to="/problems">打开题库</router-link>
          <router-link class="btn-ghost" to="/about">关于讲师</router-link>
        </div>
      </section>
    </template>
    <p v-else class="muted">载入中</p>
  </article>
</template>
