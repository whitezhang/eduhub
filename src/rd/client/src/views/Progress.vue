<script setup>
import { onMounted, ref } from "vue";
import { api } from "../api.js";

const students = ref([]);
onMounted(async () => {
  students.value = (await api("/api/progress")).students;
});
</script>

<template>
  <div class="wide">
    <h1 class="serif">榜单</h1>
    <table class="table desk">
      <thead>
        <tr><th>用户</th><th>题库（满分/部分/未做）</th><th>最近比赛</th><th>最近提交</th></tr>
      </thead>
      <tbody>
        <tr v-for="s in students" :key="s.id">
          <td><router-link :to="`/progress/${s.id}`">{{ s.display_name }}</router-link></td>
          <td>{{ s.full }} / {{ s.part }} / {{ s.untouched }}</td>
          <td>{{ s.last_contest }}</td>
          <td>{{ s.last_submit || "—" }}</td>
        </tr>
      </tbody>
    </table>
    <div class="mobile">
      <router-link v-for="s in students" :key="s.id" class="card" :to="`/progress/${s.id}`" style="display:block;text-decoration:none;color:inherit">
        <div>{{ s.display_name }}</div>
        <div class="muted">满分 {{ s.full }} · 部分 {{ s.part }} · 未做 {{ s.untouched }}</div>
        <div class="muted">{{ s.last_contest }}</div>
      </router-link>
    </div>
  </div>
</template>
