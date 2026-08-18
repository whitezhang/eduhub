<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api } from "../api.js";

const tab = ref("review");
const cms = reactive({ benefits: "", syllabus: "[]", timeline: "[]" });
const users = ref([]);
const problems = ref([]);
const contests = ref([]);
const msg = ref("");
const contest = reactive({
  title: "",
  rule: "practice",
  duration_min: 120,
  start_at: "",
  end_at: "",
  problem_ids: "",
});

const answerFilter = ref("all");
const problemQ = ref("");
const problemPage = ref(1);
const PAGE = 80;
const paperFilter = ref("all");
const paperQ = ref("");
const paperPage = ref(1);
const PAPER_PAGE = 20;
const openPaperId = ref(null);
const paperProblems = ref({});
const paperBusy = ref(false);

const filteredPapers = computed(() => {
  const q = paperQ.value.trim().toLowerCase();
  return contests.value.filter((c) => {
    if (paperFilter.value === "pending" && c.published) return false;
    if (paperFilter.value === "live" && !c.published) return false;
    if (q && !String(c.title).toLowerCase().includes(q)) return false;
    return true;
  });
});
const paperPages = computed(() => Math.max(1, Math.ceil(filteredPapers.value.length / PAPER_PAGE)));
const pagedPapers = computed(() => {
  const start = (paperPage.value - 1) * PAPER_PAGE;
  return filteredPapers.value.slice(start, start + PAPER_PAGE);
});
const withAnswerCount = computed(() => problems.value.filter((p) => p.has_answer).length);
const noAnswerCount = computed(() => problems.value.filter((p) => !p.has_answer).length);

const filteredProblems = computed(() => {
  const q = problemQ.value.trim().toLowerCase();
  return problems.value.filter((p) => {
    if (answerFilter.value === "yes" && !p.has_answer) return false;
    if (answerFilter.value === "no" && p.has_answer) return false;
    if (q && !String(p.code).toLowerCase().includes(q) && !String(p.title).toLowerCase().includes(q)) return false;
    return true;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredProblems.value.length / PAGE)));
const pagedProblems = computed(() => {
  const start = (problemPage.value - 1) * PAGE;
  return filteredProblems.value.slice(start, start + PAGE);
});

watch([answerFilter, problemQ], () => {
  problemPage.value = 1;
});
watch([paperFilter, paperQ], () => {
  paperPage.value = 1;
  openPaperId.value = null;
});

function typeLabel(p) {
  if (p.type === "traditional") return "编程";
  if (String(p.title).includes("判断")) return "判断";
  return "选择";
}

function paperKind(c) {
  if (c.is_demo) return "测试";
  if (String(c.title).startsWith("GESP")) return "真题";
  return "练习";
}

async function togglePaper(c) {
  if (openPaperId.value === c.id) {
    openPaperId.value = null;
    return;
  }
  openPaperId.value = c.id;
  if (paperProblems.value[c.id]) return;
  try {
    const data = await api(`/api/studio/contests/${c.id}`);
    paperProblems.value = { ...paperProblems.value, [c.id]: data.problems || [] };
  } catch (e) {
    msg.value = e.message;
  }
}

async function loadStudio() {
  const errors = [];
  try {
    users.value = (await api("/api/studio/users")).users;
  } catch (e) {
    errors.push(e.message);
  }
  try {
    problems.value = (await api("/api/studio/problems")).problems;
  } catch (e) {
    errors.push(e.message);
  }
  try {
    contests.value = (await api("/api/studio/contests")).contests;
  } catch (e) {
    errors.push(e.message);
  }
  if (errors.length) msg.value = errors.join("；");
}

onMounted(async () => {
  try {
    const c = await api("/api/cms");
    cms.benefits = c.benefits || "";
    cms.syllabus = JSON.stringify(c.syllabus || [], null, 2);
    cms.timeline = JSON.stringify(c.timeline || [], null, 2);
    await loadStudio();
  } catch (e) {
    msg.value = e.message;
  }
});

async function saveCms() {
  msg.value = "";
  try {
    await api("/api/studio/cms", {
      method: "PUT",
      body: {
        benefits: cms.benefits,
        syllabus: JSON.parse(cms.syllabus),
        timeline: JSON.parse(cms.timeline),
      },
    });
    msg.value = "已保存";
  } catch (e) {
    msg.value = e.message;
  }
}

async function createContest() {
  msg.value = "";
  try {
    const ids = contest.problem_ids.split(/[,，\s]+/).filter(Boolean).map(Number);
    await api("/api/studio/contests", {
      method: "POST",
      body: { ...contest, problem_ids: ids },
    });
    msg.value = "比赛已创建";
    await loadStudio();
  } catch (e) {
    msg.value = e.message;
  }
}

async function publishContest(c, on) {
  if (!on && !window.confirm(`撤回「${c.title}」后，学生将看不到这套试卷和卷内题目。确定？`)) return;
  msg.value = "";
  paperBusy.value = true;
  try {
    await api(`/api/studio/contests/${c.id}/${on ? "publish" : "unpublish"}`, { method: "POST", body: {} });
    msg.value = on ? `已发布：${c.title}` : `已撤回：${c.title}`;
    paperProblems.value = {};
    await loadStudio();
  } catch (e) {
    msg.value = e.message;
  } finally {
    paperBusy.value = false;
  }
}

async function toggleProblem(p) {
  msg.value = "";
  try {
    await api(`/api/studio/problems/${p.id}`, {
      method: "PATCH",
      body: { published: p.published ? 0 : 1 },
    });
    await loadStudio();
  } catch (e) {
    msg.value = e.message;
  }
}
</script>

<template>
  <div class="wide">
    <h1 class="serif">管理</h1>
    <p class="filter-row">
      <a href="#" :class="{ on: tab === 'review' }" @click.prevent="tab = 'review'">题目</a>
      <a href="#" :class="{ on: tab === 'cms' }" @click.prevent="tab = 'cms'">首页文案</a>
      <a href="#" :class="{ on: tab === 'contest' }" @click.prevent="tab = 'contest'">比赛</a>
      <a href="#" :class="{ on: tab === 'users' }" @click.prevent="tab = 'users'">账号</a>
    </p>
    <p v-if="msg">{{ msg }}</p>
    <section v-if="tab === 'review'">
      <h2 class="serif">试卷</h2>
      <p class="muted">
        所有试卷用同一张表。未发布：学生看不到。已发布：有答案的题进入题库，整卷出现在竞赛。
        测试卷用来练发布流程，重启服务会收回成未发布。
      </p>
      <p class="filter-row">
        <a href="#" :class="{ on: paperFilter === 'all' }" @click.prevent="paperFilter = 'all'">全部</a>
        <a href="#" :class="{ on: paperFilter === 'pending' }" @click.prevent="paperFilter = 'pending'">未发布</a>
        <a href="#" :class="{ on: paperFilter === 'live' }" @click.prevent="paperFilter = 'live'">已发布</a>
        <input v-model="paperQ" class="search" placeholder="搜索试卷名" />
      </p>
      <p class="muted">{{ filteredPapers.length }} 套</p>
      <table class="table">
        <thead>
          <tr><th>试卷</th><th>种类</th><th>题数</th><th>有答案</th><th>状态</th><th></th></tr>
        </thead>
        <tbody>
          <template v-for="c in pagedPapers" :key="c.id">
            <tr>
              <td>
                <a href="#" @click.prevent="togglePaper(c)">{{ c.title }}</a>
                <span v-if="c.is_demo" class="muted"> · 重启收回</span>
              </td>
              <td>{{ paperKind(c) }}</td>
              <td class="mono">{{ c.problem_count }}</td>
              <td class="mono">{{ c.answered_count }}</td>
              <td>{{ c.published ? "已发布" : "未发布" }}</td>
              <td>
                <button v-if="!c.published" class="btn" type="button" :disabled="paperBusy" @click="publishContest(c, true)">发布</button>
                <button v-else class="btn-ghost" type="button" :disabled="paperBusy" @click="publishContest(c, false)">撤回</button>
              </td>
            </tr>
            <tr v-if="openPaperId === c.id">
              <td colspan="6">
                <p v-if="!paperProblems[c.id]" class="muted">载入中</p>
                <table v-else class="table">
                  <thead><tr><th>题号</th><th>标题</th><th>类型</th><th>答案</th></tr></thead>
                  <tbody>
                    <tr v-for="p in paperProblems[c.id]" :key="p.id">
                      <td class="mono"><router-link :to="`/problems/${p.id}?contest=${c.id}`">{{ p.code }}</router-link></td>
                      <td>{{ p.title }}</td>
                      <td>{{ typeLabel(p) }}</td>
                      <td :class="p.has_answer ? 'ok' : 'mid'">{{ p.has_answer ? "有" : "无 · 学生看不到" }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p v-if="paperPages > 1" class="filter-row">
        <button class="btn-ghost" type="button" :disabled="paperPage <= 1" @click="paperPage -= 1">上一页</button>
        <span class="muted">{{ paperPage }} / {{ paperPages }}</span>
        <button class="btn-ghost" type="button" :disabled="paperPage >= paperPages" @click="paperPage += 1">下一页</button>
      </p>

      <h2 class="serif">全部题目</h2>
      <p class="muted">共 {{ problems.length }} 道，其中有答案 {{ withAnswerCount }} 道、无答案 {{ noAnswerCount }} 道。无答案题仅教练可见。</p>
      <p class="filter-row">
        <a href="#" :class="{ on: answerFilter === 'all' }" @click.prevent="answerFilter = 'all'">全部</a>
        <a href="#" :class="{ on: answerFilter === 'yes' }" @click.prevent="answerFilter = 'yes'">有答案</a>
        <a href="#" :class="{ on: answerFilter === 'no' }" @click.prevent="answerFilter = 'no'">无答案</a>
        <input v-model="problemQ" class="search" placeholder="搜索题号或标题" />
      </p>
      <p class="muted">当前筛选 {{ filteredProblems.length }} 道。</p>
      <table class="table">
        <thead><tr><th>题号</th><th>标题</th><th>类型</th><th>答案</th><th>备注</th><th></th></tr></thead>
        <tbody>
          <tr v-for="p in pagedProblems" :key="p.id">
            <td class="mono"><router-link :to="`/problems/${p.id}`">{{ p.code }}</router-link></td>
            <td>{{ p.title }}</td>
            <td>{{ typeLabel(p) }}</td>
            <td :class="p.has_answer ? 'ok' : 'mid'">{{ p.has_answer ? "有" : "无" }}</td>
            <td class="muted">{{ p.review_note }}</td>
            <td><button class="btn-ghost" type="button" @click="toggleProblem(p)">{{ p.published ? "撤回" : "发布" }}</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="totalPages > 1" class="filter-row">
        <button class="btn-ghost" type="button" :disabled="problemPage <= 1" @click="problemPage -= 1">上一页</button>
        <span class="muted">{{ problemPage }} / {{ totalPages }}</span>
        <button class="btn-ghost" type="button" :disabled="problemPage >= totalPages" @click="problemPage += 1">下一页</button>
      </p>
    </section>
    <section v-if="tab === 'cms'">
      <label class="field">学习信息学的好处
        <textarea v-model="cms.benefits" rows="8"></textarea>
      </label>
      <label class="field">教学大纲（JSON）
        <textarea v-model="cms.syllabus" rows="10" class="mono"></textarea>
      </label>
      <label class="field">时间节点（JSON）
        <textarea v-model="cms.timeline" rows="10" class="mono"></textarea>
      </label>
      <button class="btn" type="button" @click="saveCms">保存</button>
    </section>
    <section v-if="tab === 'contest'">
      <label class="field">名称 <input v-model="contest.title" /></label>
      <label class="field">赛制
        <select v-model="contest.rule">
          <option value="practice">练习</option>
          <option value="oi">OI</option>
          <option value="ioi">IOI</option>
        </select>
      </label>
      <label class="field">时长（分钟） <input v-model.number="contest.duration_min" /></label>
      <label class="field">开始（ISO） <input v-model="contest.start_at" placeholder="2026-08-18T12:00:00.000Z" /></label>
      <label class="field">结束 <input v-model="contest.end_at" /></label>
      <label class="field">题目 id，逗号分隔
        <input v-model="contest.problem_ids" :placeholder="problems.map(p => p.id).join(',')" />
      </label>
      <button class="btn" type="button" @click="createContest">创建比赛</button>
    </section>
    <section v-if="tab === 'users'">
      <table class="table">
        <thead><tr><th>用户名</th><th>显示名</th><th>角色</th></tr></thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="mono">{{ u.username }}</td>
            <td>{{ u.display_name }}</td>
            <td>{{ u.role }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
