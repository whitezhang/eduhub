<script setup>
defineProps({
  variant: { type: String, default: "default" },
});
</script>

<template>
  <div class="auth-skeleton" aria-hidden="true">
    <template v-if="variant === 'problems'">
      <div class="auth-skel-bar auth-skel-bar--lg" />
      <div class="auth-skel-chips">
        <span v-for="n in 4" :key="n" class="auth-skel-chip" />
      </div>
      <div class="auth-skel-split">
        <aside class="auth-skel-side">
          <span v-for="n in 6" :key="n" class="auth-skel-line" />
        </aside>
        <div class="auth-skel-main">
          <div class="auth-skel-bar auth-skel-bar--md" />
          <div v-for="n in 5" :key="n" class="auth-skel-row" />
        </div>
      </div>
    </template>

    <template v-else-if="variant === 'syllabus'">
      <div class="auth-skel-bar auth-skel-bar--lg" />
      <div class="auth-skel-chips">
        <span v-for="n in 4" :key="n" class="auth-skel-chip" />
      </div>
      <div class="auth-skel-split">
        <div class="auth-skel-main">
          <div class="auth-skel-bar auth-skel-bar--md" />
          <div v-for="n in 6" :key="n" class="auth-skel-block" />
        </div>
      </div>
    </template>

    <template v-else-if="variant === 'external' || variant === 'progress'">
      <div class="auth-skel-bar auth-skel-bar--lg" />
      <div class="auth-skel-bar auth-skel-bar--md" />
      <div v-for="n in 8" :key="n" class="auth-skel-row" />
    </template>

    <template v-else>
      <div class="auth-skel-bar auth-skel-bar--lg" />
      <div v-for="n in 4" :key="n" class="auth-skel-block" />
    </template>
  </div>
</template>
