<script setup>
import { computed } from "vue";
import { renderStatement } from "../statement.js";

const props = defineProps({ text: { type: String, default: "" } });
const html = computed(() => renderStatement(props.text));
</script>

<template>
  <div class="stem" v-html="html"></div>
</template>
