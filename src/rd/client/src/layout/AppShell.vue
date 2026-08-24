<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useSession } from "../stores/session.js";
import { authSectionHint } from "../composables/useAuthWall.js";

const route = useRoute();
const session = useSession();
const menuOpen = ref(false);
const form = reactive({ username: "", password: "", error: "" });
const profile = reactive({ display_name: "", error: "" });

const showAuthWall = computed(() => Boolean(route.meta.requiresAuth && !session.user));
const loginHint = computed(() => {
  if (route.meta.sectionTitle) return `登录后查看${route.meta.sectionTitle}`;
  return authSectionHint(route.path);
});

function onLoginBackdropClick() {
  if (showAuthWall.value) return;
  session.closeLogin();
}

function onKeydown(e) {
  if (e.key === "Escape" && session.loginOpen && !showAuthWall.value) {
    session.closeLogin();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

watch(
  () => session.loginOpen,
  (open) => {
    if (open) form.error = "";
  },
);

watch(
  () => session.profileOpen,
  (open) => {
    if (open) {
      profile.display_name = session.user?.display_name || "";
      profile.error = "";
    }
  },
);

async function submit() {
  form.error = "";
  try {
    await session.login(form.username, form.password);
  } catch (e) {
    form.error = e.message;
  }
}

async function saveProfile() {
  profile.error = "";
  try {
    await session.updateDisplayName(profile.display_name);
  } catch (e) {
    profile.error = e.message;
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
        <router-link to="/news" :class="{ 'router-link-active': route.path.startsWith('/news') }">新闻</router-link>
        <router-link to="/syllabus" :class="{ 'router-link-active': route.path.startsWith('/syllabus') }">教学大纲</router-link>
        <router-link to="/problems">题库</router-link>
        <router-link to="/external">外部资料</router-link>
        <router-link to="/progress">榜单</router-link>
        <router-link v-if="session.user?.role === 'coach'" to="/studio">管理</router-link>
        <a href="https://about.jsoner.cn/" target="_blank" rel="noopener noreferrer">关于</a>
      </nav>
      <div class="top-right">
        <template v-if="session.user">
          <button class="btn-ghost" type="button" @click="session.openProfile()">
            {{ session.user.display_name }}
          </button>
          <button class="btn-ghost" type="button" @click="session.logout()">退出</button>
        </template>
        <button v-else class="btn-ghost" type="button" @click="session.openLogin()">登录</button>
      </div>
    </header>
    <div class="shell-body" :class="{ 'shell-body--auth-wall': showAuthWall }">
      <main class="main" :aria-hidden="showAuthWall && session.loginOpen ? 'true' : undefined">
        <slot />
      </main>
      <footer class="foot">
        非中国计算机学会官方站点。训练与模拟用。GESP / NOI 报名请走官网。
      </footer>
    </div>
    <div
      v-if="session.loginOpen"
      class="modal-bg"
      role="presentation"
      @click.self="onLoginBackdropClick"
    >
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <h2 id="login-title" class="serif">登录</h2>
        <p v-if="showAuthWall" class="muted login-hint">{{ loginHint }}</p>
        <form @submit.prevent="submit">
          <label class="field">用户名
            <input v-model="form.username" autocomplete="username" required />
          </label>
          <label class="field">密码
            <input v-model="form.password" type="password" autocomplete="current-password" required />
          </label>
          <p v-if="form.error" class="err">{{ form.error }}</p>
          <button class="btn" type="submit">登录</button>
        </form>
        <p class="muted" style="margin-top:1rem">账号由管理员添加。</p>
      </div>
    </div>
    <div v-if="session.profileOpen" class="modal-bg" @click.self="session.closeProfile()">
      <div class="modal" role="dialog" aria-labelledby="profile-title">
        <h2 id="profile-title" class="serif">修改显示名</h2>
        <p class="muted">用户名：{{ session.user?.username }}（不可改）</p>
        <form @submit.prevent="saveProfile">
          <label class="field">显示名
            <input v-model="profile.display_name" maxlength="40" required />
          </label>
          <p v-if="profile.error" class="err">{{ profile.error }}</p>
          <button class="btn" type="submit">保存</button>
        </form>
      </div>
    </div>
  </div>
</template>
