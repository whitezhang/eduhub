<script setup>
const profile = {
  name: "whitezhang",
  tagline: "P8，做有意思的事",
  avatar: "/images/avatar.png",
  experience: [
    { period: "2026/06 –", place: "To be continued", now: true },
    { period: "2025/10 – 2026/06", place: "京东", role: "架构师" },
    { period: "2015/12 – 2025/10", place: "百度", role: "架构师" },
  ],
};
</script>

<template>
  <article class="read about-page">
    <header class="about-hero">
      <img class="about-avatar" :src="profile.avatar" :alt="profile.name" width="88" height="88" />
      <div>
        <h1 class="serif">{{ profile.name }}</h1>
        <p class="about-tagline">{{ profile.tagline }}</p>
      </div>
    </header>

    <section class="about-section">
      <header class="chapter-head">
        <h2 class="serif">履历</h2>
      </header>
      <ol class="about-timeline">
        <li v-for="(row, i) in profile.experience" :key="i" :class="{ 'is-now': row.now }">
          <span class="mono muted">{{ row.period }}</span>
          <span>
            <strong>{{ row.place }}</strong>
            <template v-if="row.role"> · {{ row.role }}</template>
          </span>
        </li>
      </ol>
    </section>
  </article>
</template>
