import { createRouter, createWebHistory } from "vue-router";
import Home from "./views/Home.vue";
import Problems from "./views/Problems.vue";
import ProblemSolve from "./views/ProblemSolve.vue";
import External from "./views/External.vue";
import Progress from "./views/Progress.vue";
import ProgressUser from "./views/ProgressUser.vue";
import Studio from "./views/Studio.vue";
import StudioProblemEdit from "./views/StudioProblemEdit.vue";
import PaperWorkbook from "./views/PaperWorkbook.vue";
import { useSession } from "./stores/session.js";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Home },
    { path: "/problems", component: Problems },
    { path: "/problems/papers/:id", component: PaperWorkbook, meta: { requiresAuth: true } },
    { path: "/problems/:id", component: ProblemSolve, meta: { requiresAuth: true } },
    { path: "/contests", redirect: "/problems" },
    { path: "/contests/:id", redirect: (to) => `/problems/papers/${to.params.id}` },
    { path: "/external", component: External },
    { path: "/progress", component: Progress },
    { path: "/progress/:id", component: ProgressUser },
    { path: "/studio", component: Studio },
    { path: "/studio/problems/:id", component: StudioProblemEdit },
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
  session.openLogin();
  const q = {};
  if (to.query.source) q.source = String(to.query.source);
  return { path: "/problems", query: q };
});

export default router;
