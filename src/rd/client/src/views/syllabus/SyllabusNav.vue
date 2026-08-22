<script setup>
const props = defineProps({
  tracks: { type: Array, default: () => [] },
  track: { type: String, default: "" },
  compact: { type: Boolean, default: false },
  labelFn: { type: Function, default: null },
});
const emit = defineEmits(["pick"]);

function labelOf(t) {
  if (typeof props.labelFn === "function") return props.labelFn(t.title) || t.title;
  return t.title;
}
</script>

<template>
  <header class="syll-hero" :class="{ compact }">
    <div class="syll-hero-top">
      <h1 class="serif">教学大纲</h1>
      <div class="syll-tracks" role="tablist" aria-label="赛道">
        <button
          v-for="t in tracks"
          :key="t.slug"
          type="button"
          class="syll-track"
          :class="{ on: track === t.slug }"
          @click="emit('pick', t.slug)"
        >{{ labelOf(t) }}</button>
      </div>
    </div>
    <p v-if="!compact" class="muted syll-hero-blurb">参考 NOI 2025 大纲。CSP-J/S：初赛客观题，复赛编程题。</p>
  </header>
</template>
