<script setup>
import { onMounted } from "vue";
import AppShell from "./layout/AppShell.vue";
import { useSession } from "./stores/session.js";

const session = useSession();
onMounted(() => session.refresh());
</script>

<template>
  <AppShell>
    <router-view />
  </AppShell>
</template>
