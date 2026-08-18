import { createRouter, createWebHistory } from "vue-router";
import Home from "./views/Home.vue";
import Problems from "./views/Problems.vue";
import ProblemSolve from "./views/ProblemSolve.vue";
import Contests from "./views/Contests.vue";
import ContestDetail from "./views/ContestDetail.vue";
import External from "./views/External.vue";
import Progress from "./views/Progress.vue";
import ProgressUser from "./views/ProgressUser.vue";
import Studio from "./views/Studio.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Home },
    { path: "/problems", component: Problems },
    { path: "/problems/:id", component: ProblemSolve },
    { path: "/contests", component: Contests },
    { path: "/contests/:id", component: ContestDetail },
    { path: "/external", component: External },
    { path: "/progress", component: Progress },
    { path: "/progress/:id", component: ProgressUser },
    { path: "/studio", component: Studio },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});
