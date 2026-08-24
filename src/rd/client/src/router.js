import { createRouter, createWebHistory } from "vue-router";
import Home from "./views/Home.vue";
import News from "./views/News.vue";
import Problems from "./views/Problems.vue";
import ProblemSolve from "./views/ProblemSolve.vue";
import External from "./views/External.vue";
import Progress from "./views/Progress.vue";
import ProgressUser from "./views/ProgressUser.vue";
import Studio from "./views/Studio.vue";
import StudioProblemEdit from "./views/StudioProblemEdit.vue";
import PaperWorkbook from "./views/PaperWorkbook.vue";
import SyllabusOverview from "./views/syllabus/SyllabusOverview.vue";
import { useSession } from "./stores/session.js";

const ABOUT_URL = "https://about.jsoner.cn/";

const authMeta = { requiresAuth: true };

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Home },
    { path: "/news", redirect: "/news/policy" },
    { path: "/news/:tab(policy|contests)", component: News },
    { path: "/policy", redirect: "/news/policy" },
    { path: "/syllabus", component: SyllabusOverview, meta: { ...authMeta, sectionTitle: "教学大纲" } },
    { path: "/syllabus/guide", redirect: (to) => ({ path: "/syllabus", query: to.query }) },
    { path: "/syllabus/topic/:id", redirect: (to) => ({ path: "/syllabus", query: to.query }) },
    { path: "/problems", component: Problems, meta: { ...authMeta, sectionTitle: "题库" } },
    { path: "/problems/papers/:id", component: PaperWorkbook, meta: { ...authMeta, sectionTitle: "题库" } },
    { path: "/problems/:id", component: ProblemSolve, meta: { ...authMeta, sectionTitle: "题库" } },
    { path: "/contests", redirect: "/problems" },
    { path: "/contests/:id", redirect: (to) => `/problems/papers/${to.params.id}` },
    { path: "/external", component: External, meta: { ...authMeta, sectionTitle: "外部资料" } },
    { path: "/progress", component: Progress, meta: { ...authMeta, sectionTitle: "榜单" } },
    { path: "/progress/:id", component: ProgressUser, meta: { ...authMeta, sectionTitle: "榜单" } },
    { path: "/studio", component: Studio },
    { path: "/studio/problems/:id", component: StudioProblemEdit },
    { path: "/about", beforeEnter: () => { window.location.assign(ABOUT_URL); return false; } },
  ],
  scrollBehavior(to, from, savedPosition) {
    if (to.hash) {
      return { el: to.hash, behavior: "smooth", top: 16 };
    }
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true;
  const session = useSession();
  if (!session.ready) {
    try {
      await session.refresh();
    } catch {
      session.ready = true;
    }
  }
  if (session.user) return true;
  session.openLogin(to.fullPath);
  return true;
});

export default router;
