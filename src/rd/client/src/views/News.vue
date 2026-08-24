<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";

const DEFAULT_POLICY_INTRO = "教育部、国务院政策库等官方文件，按出台时间排列。";
const DEFAULT_CONTESTS_INTRO = "一线城市与公开赛事活动，按年内举办时间排列。";

const TABS = [
  { id: "policy", label: "政策", path: "/news/policy" },
  { id: "contests", label: "公开赛", path: "/news/contests" },
];

const route = useRoute();
const router = useRouter();

const tab = computed(() => {
  const t = String(route.params.tab || "policy");
  return t === "contests" ? "contests" : "policy";
});

const policyIntro = ref("");
const policyFeed = ref([]);
const syncedAt = ref(null);
const stale = ref(false);
const contestSyncedAt = ref(null);
const contestsStale = ref(false);
const contestsIntro = ref(DEFAULT_CONTESTS_INTRO);
const contestsFeed = ref([]);
const loading = ref(true);
const err = ref("");

const sortedPolicy = computed(() => {
  return [...policyFeed.value]
    .filter((item) => item?.url)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
});

const sortedContests = computed(() => {
  return [...contestsFeed.value].filter((item) => item?.url);
});

async function load() {
  loading.value = true;
  err.value = "";
  try {
    const [policy, contests] = await Promise.all([
      api("/api/cms?scope=policy"),
      api("/api/cms?scope=contests"),
    ]);
    policyIntro.value = String(policy.policy_intro || "").trim() || DEFAULT_POLICY_INTRO;
    policyFeed.value = policy.policy_feed || [];
    syncedAt.value = policy.synced_at || null;
    if (syncedAt.value) {
      const age = Date.now() - Date.parse(syncedAt.value);
      stale.value = Number.isFinite(age) && age > 48 * 60 * 60 * 1000;
    } else {
      stale.value = false;
    }
    contestsIntro.value = String(contests.contests_intro || "").trim() || DEFAULT_CONTESTS_INTRO;
    contestsFeed.value = contests.contest_feed || [];
    contestSyncedAt.value = contests.synced_at || null;
    if (contestSyncedAt.value) {
      const age = Date.now() - Date.parse(contestSyncedAt.value);
      contestsStale.value = Number.isFinite(age) && age > 48 * 60 * 60 * 1000;
    } else {
      contestsStale.value = false;
    }
  } catch (e) {
    err.value = e.message;
    policyFeed.value = [];
    contestsFeed.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => route.params.tab,
  (t) => {
    if (t !== "policy" && t !== "contests") {
      router.replace("/news/policy");
    }
  },
);
</script>

<template>
  <article class="read news-page">
    <header class="news-head">
      <h1 class="serif">新闻</h1>
      <nav class="news-tabs" aria-label="新闻分类">
        <router-link
          v-for="item in TABS"
          :key="item.id"
          :to="item.path"
          class="news-tab"
          :class="{ 'is-active': tab === item.id }"
        >{{ item.label }}</router-link>
      </nav>
    </header>

    <p v-if="err" class="err">{{ err }}</p>
    <p v-else-if="loading" class="muted">载入中</p>

    <template v-else-if="tab === 'policy'">
      <p class="news-intro">{{ policyIntro }}</p>
      <ul v-if="sortedPolicy.length" class="home-ref-list">
        <li v-for="(item, i) in sortedPolicy" :key="i" class="home-ref-item">
          <span v-if="item.date" class="home-ref-date mono">{{ item.date }}</span>
          <div class="home-ref-main">
            <a
              class="home-ref-title"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
            >{{ item.title }}</a>
            <p v-if="item.summary" class="home-ref-summary">{{ item.summary }}</p>
          </div>
        </li>
      </ul>
      <p v-else class="muted">暂无政策条目，请稍后刷新。</p>
      <p v-if="syncedAt" class="policy-meta muted">
        更新于 {{ syncedAt }}<span v-if="stale"> · 可能不是最新</span>
      </p>
    </template>

    <template v-else>
      <p class="news-intro">{{ contestsIntro }}</p>
      <ul v-if="sortedContests.length" class="home-ref-list">
        <li v-for="(item, i) in sortedContests" :key="i" class="home-ref-item">
          <span v-if="item.when || item.date" class="home-ref-date mono">{{ item.when || item.date }}</span>
          <div class="home-ref-main">
            <a
              class="home-ref-title"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
            >{{ item.title }}</a>
            <p v-if="item.summary" class="home-ref-summary">{{ item.summary }}</p>
            <p v-if="item.showcase_url" class="home-ref-showcase">
              <a
                :href="item.showcase_url"
                target="_blank"
                rel="noopener noreferrer"
              >{{ item.showcase_label || "成果展示" }}</a>
            </p>
          </div>
        </li>
      </ul>
      <p v-else class="muted">暂无公开赛条目，请稍后刷新。</p>
      <p v-if="contestSyncedAt" class="policy-meta muted">
        更新于 {{ contestSyncedAt }}<span v-if="contestsStale"> · 可能不是最新</span>
      </p>
    </template>
  </article>
</template>
