<script setup>
import { onMounted, ref } from "vue";
import { api } from "../api.js";

const contests = ref([]);
const err = ref("");

function ruleName(r) {
  return { practice: "练习", oi: "OI", ioi: "IOI" }[r] || r;
}
function stateName(s) {
  return { upcoming: "未开始", running: "进行中", ended: "已结束" }[s] || s;
}

onMounted(async () => {
  try {
    contests.value = (await api("/api/contests")).contests;
  } catch (e) {
    err.value = e.message;
  }
});
</script>

<template>
  <div class="wide">
    <h1 class="serif">竞赛</h1>
    <p class="muted">本平台模拟赛。官方赛事见「外部竞赛」。</p>
    <p v-if="err" class="err">{{ err }}</p>
    <table class="table desk">
      <thead>
        <tr><th>名称</th><th>赛制</th><th>时长</th><th>状态</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="c in contests" :key="c.id">
          <td>{{ c.title }}</td>
          <td>{{ ruleName(c.rule) }}</td>
          <td>{{ c.duration_min }} 分钟</td>
          <td>{{ stateName(c.state) }}</td>
          <td><router-link :to="`/contests/${c.id}`">进入</router-link></td>
        </tr>
      </tbody>
    </table>
    <div class="mobile">
      <router-link v-for="c in contests" :key="c.id" class="card" :to="`/contests/${c.id}`" style="display:block;text-decoration:none;color:inherit">
        <div>{{ c.title }}</div>
        <div class="muted">{{ ruleName(c.rule) }} · {{ stateName(c.state) }} · 进入</div>
      </router-link>
    </div>
  </div>
</template>
