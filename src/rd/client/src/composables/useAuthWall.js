import { computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useSession } from "../stores/session.js";

export function useAuthWall() {
  const route = useRoute();
  const session = useSession();
  const locked = computed(() => Boolean(route.meta.requiresAuth && !session.user));
  return { locked, session };
}

/** Call load only when logged in; re-run after login. */
export function useProtectedLoad(loadFn) {
  const { locked, session } = useAuthWall();
  function run() {
    if (!session.user) return;
    return loadFn();
  }
  onMounted(run);
  watch(() => session.user, (u) => {
    if (u) run();
  });
  return { locked };
}

export function authSectionHint(path) {
  if (path.startsWith("/syllabus")) return "登录后查看教学大纲";
  if (path.startsWith("/problems")) return "登录后查看题库";
  if (path.startsWith("/external")) return "登录后查看外部资料";
  if (path.startsWith("/progress")) return "登录后查看榜单";
  return "登录后可继续浏览与做题";
}
