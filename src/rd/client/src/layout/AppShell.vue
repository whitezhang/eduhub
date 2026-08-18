<script setup>
import { reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useSession } from "../stores/session.js";

const route = useRoute();
const session = useSession();
const menuOpen = ref(false);
const form = reactive({ username: "", password: "", display_name: "", mode: "login", error: "" });

watch(
  () => session.loginOpen,
  (open) => {
    if (open) {
      form.mode = "login";
      form.error = "";
    }
  },
);

async function submit() {
  form.error = "";
  try {
    if (form.mode === "login") await session.login(form.username, form.password);
    else await session.register(form.username, form.password, form.display_name);
  } catch (e) {
    form.error = e.message;
  }
}
</script>

<template>
  <div class="shell">
    <header class="topbar" :class="{ open: menuOpen }">
      <router-link class="brand" to="/" @click="menuOpen = false">EduHub</router-link>
      <button class="menu-btn" type="button" @click="menuOpen = !menuOpen">菜单</button>
      <nav class="nav" @click="menuOpen = false">
        <router-link to="/" :class="{ 'router-link-active': route.path === '/' }">首页</router-link>
        <router-link to="/problems">题库</router-link>
        <router-link to="/external">外部资料</router-link>
        <router-link to="/progress">榜单</router-link>
        <router-link v-if="session.user?.role === 'coach'" to="/studio">管理</router-link>
      </nav>
      <div class="top-right">
        <template v-if="session.user">
          <span class="muted">{{ session.user.display_name }}</span>
          <button class="btn-ghost" type="button" @click="session.logout()">退出</button>
        </template>
        <button v-else class="btn-ghost" type="button" @click="session.openLogin()">登录</button>
      </div>
    </header>
    <main class="main">
      <slot />
    </main>
    <footer class="foot">
      非中国计算机学会官方站点。训练与模拟用。GESP / NOI 报名请走官网。
    </footer>
    <div v-if="session.loginOpen" class="modal-bg" @click.self="session.closeLogin()">
      <div class="modal" role="dialog" aria-labelledby="login-title">
        <h2 id="login-title" class="serif">{{ form.mode === "login" ? "登录" : "注册" }}</h2>
        <form @submit.prevent="submit">
          <label class="field">用户名
            <input v-model="form.username" autocomplete="username" required />
          </label>
          <label v-if="form.mode === 'register'" class="field">显示名
            <input v-model="form.display_name" />
          </label>
          <label class="field">密码
            <input v-model="form.password" type="password" autocomplete="current-password" required />
          </label>
          <p v-if="form.error" class="err">{{ form.error }}</p>
          <button class="btn" type="submit">{{ form.mode === "login" ? "登录" : "注册" }}</button>
          <button class="btn-ghost" type="button" style="margin-left:0.5rem" @click="form.mode = form.mode === 'login' ? 'register' : 'login'">
            {{ form.mode === "login" ? "没有账号，去注册" : "已有账号，去登录" }}
          </button>
        </form>
        <p class="muted" style="margin-top:1rem">示例：coach / eduhub，student / eduhub</p>
      </div>
    </div>
  </div>
</template>
