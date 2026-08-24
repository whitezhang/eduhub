<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api } from "../api.js";

const tab = ref("review");
const cms = reactive({
  hero_pitch: "",
  star_s: "",
  star_t: "",
  star_r: "",
  case_studies: "[]",
  star_s_links: "{\"tier1\":[]}",
  policy_intro: "",
  contests_intro: "",
  syllabus: "[]",
  timeline: "[]",
});
const policyItems = ref([]);
const policySyncedAt = ref("");
const policySyncBusy = ref(false);
const contestItems = ref([]);
const contestSyncedAt = ref("");
const contestSyncBusy = ref(false);
const users = ref([]);
const newUser = reactive({ username: "", password: "" });
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

function parsePaperQuery(raw) {
  const needle = raw.trim().toLowerCase();
  const wantNoAnswer = needle.includes("无答案");
  const titlePart = needle.replace(/无答案/g, "").trim();
  return { wantNoAnswer, titlePart };
}

const parsedPaperQuery = computed(() => parsePaperQuery(paperQ.value));

const filteredPapers = computed(() => {
  const { wantNoAnswer, titlePart } = parsedPaperQuery.value;
  return contests.value.filter((c) => {
    if (paperFilter.value === "pending" && c.published) return false;
    if (paperFilter.value === "live" && !c.published) return false;
    if (wantNoAnswer && (c.problem_count || 0) <= (c.answered_count || 0)) return false;
    if (titlePart && !String(c.title).toLowerCase().includes(titlePart)) return false;
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
    cms.hero_pitch = c.hero_pitch || "";
    cms.star_s = c.star_s || "";
    cms.star_t = c.star_t || "";
    cms.star_r = c.star_r || "";
    cms.case_studies = JSON.stringify(c.case_studies || [], null, 2);
    cms.star_s_links = JSON.stringify(c.star_s_links || { tier1: [] }, null, 2);
    cms.policy_intro = c.policy_intro || "";
    cms.contests_intro = c.contests_intro || "";
    cms.syllabus = JSON.stringify(c.syllabus || [], null, 2);
    cms.timeline = JSON.stringify(c.timeline || [], null, 2);
    await loadPolicyItems();
    await loadContestItems();
    await loadStudio();
  } catch (e) {
    msg.value = e.message;
  }
});

async function loadPolicyItems() {
  try {
    const data = await api("/api/studio/policy-items");
    policyItems.value = data.items || [];
    policySyncedAt.value = data.synced_at || "";
  } catch (e) {
    msg.value = e.message;
  }
}

async function runPolicySync() {
  policySyncBusy.value = true;
  msg.value = "";
  try {
    const result = await api("/api/studio/policy-sync", { method: "POST" });
    msg.value = `政策同步完成：新增 ${result.added ?? 0} 条`;
    await loadPolicyItems();
  } catch (e) {
    msg.value = e.message;
  } finally {
    policySyncBusy.value = false;
  }
}

async function publishPolicyItem(id) {
  try {
    await api(`/api/studio/policy-items/${id}/publish`, { method: "POST" });
    await loadPolicyItems();
    msg.value = "已发布";
  } catch (e) {
    msg.value = e.message;
  }
}

async function rejectPolicyItem(id) {
  try {
    await api(`/api/studio/policy-items/${id}/reject`, { method: "POST" });
    await loadPolicyItems();
    msg.value = "已驳回";
  } catch (e) {
    msg.value = e.message;
  }
}

const pendingPolicyItems = computed(() => policyItems.value.filter((i) => i.status === "pending"));

async function loadContestItems() {
  try {
    const data = await api("/api/studio/contest-items");
    contestItems.value = data.items || [];
    contestSyncedAt.value = data.synced_at || "";
  } catch (e) {
    msg.value = e.message;
  }
}

async function runContestSync() {
  contestSyncBusy.value = true;
  msg.value = "";
  try {
    const result = await api("/api/studio/contest-sync", { method: "POST" });
    msg.value = `公开赛同步完成：新增 ${result.added ?? 0} 条`;
    await loadContestItems();
  } catch (e) {
    msg.value = e.message;
  } finally {
    contestSyncBusy.value = false;
  }
}

async function publishContestItem(id) {
  try {
    await api(`/api/studio/contest-items/${id}/publish`, { method: "POST" });
    await loadContestItems();
    msg.value = "已发布";
  } catch (e) {
    msg.value = e.message;
  }
}

async function rejectContestItem(id) {
  try {
    await api(`/api/studio/contest-items/${id}/reject`, { method: "POST" });
    await loadContestItems();
    msg.value = "已驳回";
  } catch (e) {
    msg.value = e.message;
  }
}

const pendingContestItems = computed(() => contestItems.value.filter((i) => i.status === "pending"));

async function saveCms() {
  msg.value = "";
  try {
    await api("/api/studio/cms", {
      method: "PUT",
      body: {
        hero_pitch: cms.hero_pitch,
        star_s: cms.star_s,
        star_t: cms.star_t,
        star_r: cms.star_r,
        case_studies: JSON.parse(cms.case_studies),
        star_s_links: JSON.parse(cms.star_s_links),
        policy_intro: cms.policy_intro,
        contests_intro: cms.contests_intro,
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

async function createUser() {
  msg.value = "";
  newUser.username = "";
  newUser.password = "";
  try {
    const data = await api("/api/studio/users", { method: "POST", body: {} });
    newUser.username = data.user.username;
    newUser.password = data.password;
    msg.value = "已创建学生账号，请把用户名和初始密码发给学生。";
    await loadStudio();
  } catch (e) {
    msg.value = e.message;
  }
}

async function copyCreds() {
  if (!newUser.username || !newUser.password) return;
  const text = `用户名：${newUser.username}\n初始密码：${newUser.password}`;
  try {
    await navigator.clipboard.writeText(text);
    msg.value = "已复制到剪贴板";
  } catch {
    msg.value = "复制失败，请手动抄写";
  }
}

async function deleteUser(u) {
  if (u.role !== "student") return;
  if (!window.confirm(`确定删除学生账号「${u.username}」？提交记录等数据会一并删除，且不可恢复。`)) return;
  msg.value = "";
  try {
    await api(`/api/studio/users/${u.id}`, { method: "DELETE" });
    msg.value = `已删除：${u.username}`;
    if (newUser.username === u.username) {
      newUser.username = "";
      newUser.password = "";
    }
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
        所有试卷用同一张表。未发布：学生看不到。已发布：题目进入题库（无答案也可作答，但不评分）。
        点「编辑」改题面；保存后写入本机库与 catalog，上线需 git push 再 deploy。
      </p>
      <p class="filter-row">
        <a href="#" :class="{ on: paperFilter === 'all' }" @click.prevent="paperFilter = 'all'">全部</a>
        <a href="#" :class="{ on: paperFilter === 'pending' }" @click.prevent="paperFilter = 'pending'">未发布</a>
        <a href="#" :class="{ on: paperFilter === 'live' }" @click.prevent="paperFilter = 'live'">已发布</a>
        <input v-model="paperQ" class="search" placeholder="搜索试卷名，或输入「无答案」" />
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
                <span
                  v-if="(c.problem_count || 0) > (c.answered_count || 0)"
                  class="tag-warn"
                >无答案 {{ (c.problem_count || 0) - (c.answered_count || 0) }}</span>
              </td>
              <td>{{ paperKind(c) }}</td>
              <td class="mono">{{ c.problem_count }}</td>
              <td class="mono" :class="(c.problem_count || 0) > (c.answered_count || 0) ? 'mid' : 'ok'">{{ c.answered_count }}</td>
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
                  <thead><tr><th>题号</th><th>标题</th><th>类型</th><th>答案</th><th></th></tr></thead>
                  <tbody>
                    <tr v-for="p in paperProblems[c.id]" :key="p.id">
                      <td class="mono"><router-link :to="`/problems/${p.id}?contest=${c.id}`">{{ p.code }}</router-link></td>
                      <td>{{ p.title }}</td>
                      <td>{{ typeLabel(p) }}</td>
                      <td :class="p.has_answer ? 'ok' : 'mid'">
                        <span v-if="p.has_answer">有</span>
                        <span v-else class="tag-warn">无答案</span>
                      </td>
                      <td><router-link :to="`/studio/problems/${p.id}`">编辑</router-link></td>
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
      <p class="muted">共 {{ problems.length }} 道，其中有答案 {{ withAnswerCount }} 道、无答案 {{ noAnswerCount }} 道。客观题看标准答案；编程题看满分程序。无答案题学生可见，作答不评分。</p>
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
            <td :class="p.has_answer ? 'ok' : 'mid'">
              <span v-if="p.has_answer">有</span>
              <span v-else class="tag-warn">无答案</span>
            </td>
            <td class="muted">{{ p.review_note }}</td>
            <td class="filter-row" style="margin:0;gap:0.5rem;flex-wrap:nowrap">
              <router-link :to="`/studio/problems/${p.id}`">编辑</router-link>
              <button class="btn-ghost" type="button" @click="toggleProblem(p)">{{ p.published ? "撤回" : "发布" }}</button>
            </td>
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
      <label class="field">顶区主张（hero_pitch）
        <textarea v-model="cms.hero_pitch" rows="2"></textarea>
      </label>
      <label class="field">STAR 场景（star_s，空行分段：政策 / 一线 / 趋势 / 我们该怎么做）
        <textarea v-model="cms.star_s" rows="10"></textarea>
      </label>
      <label class="field">STAR 任务（star_t）
        <textarea v-model="cms.star_t" rows="5"></textarea>
      </label>
      <label class="field">STAR 结果（star_r）
        <textarea v-model="cms.star_r" rows="5"></textarea>
      </label>
      <label class="field">场景链接（star_s_links JSON：tier1 为公开赛种子，同步到 contest_items）
        <textarea v-model="cms.star_s_links" rows="8" class="mono"></textarea>
      </label>
      <label class="field">政策页导语（policy_intro）
        <textarea v-model="cms.policy_intro" rows="2"></textarea>
      </label>
      <div class="field">
        <div class="studio-policy-head">
          <span>国家政策同步（policy_items 表）</span>
          <button class="btn-ghost" type="button" :disabled="policySyncBusy" @click="runPolicySync">
            {{ policySyncBusy ? "同步中…" : "立即抓取" }}
          </button>
        </div>
        <p v-if="policySyncedAt" class="muted">上次同步：{{ policySyncedAt }}</p>
        <p v-if="pendingPolicyItems.length" class="muted">待审核 {{ pendingPolicyItems.length }} 条</p>
        <ul v-if="pendingPolicyItems.length" class="studio-policy-pending">
          <li v-for="item in pendingPolicyItems" :key="item.id" class="studio-policy-row">
            <span class="mono">{{ item.date }}</span>
            <a :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
            <button class="btn-ghost" type="button" @click="publishPolicyItem(item.id)">发布</button>
            <button class="btn-ghost" type="button" @click="rejectPolicyItem(item.id)">驳回</button>
          </li>
        </ul>
        <p v-else class="muted">暂无待审核条目。</p>
      </div>
      <label class="field">公开赛页导语（contests_intro）
        <textarea v-model="cms.contests_intro" rows="2"></textarea>
      </label>
      <div class="field">
        <div class="studio-policy-head">
          <span>公开赛同步（contest_items 表）</span>
          <button class="btn-ghost" type="button" :disabled="contestSyncBusy" @click="runContestSync">
            {{ contestSyncBusy ? "同步中…" : "立即抓取" }}
          </button>
        </div>
        <p v-if="contestSyncedAt" class="muted">上次同步：{{ contestSyncedAt }}</p>
        <p v-if="pendingContestItems.length" class="muted">待审核 {{ pendingContestItems.length }} 条</p>
        <ul v-if="pendingContestItems.length" class="studio-policy-pending">
          <li v-for="item in pendingContestItems" :key="item.id" class="studio-policy-row">
            <span class="mono">{{ item.when_label || "—" }}</span>
            <a :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
            <button class="btn-ghost" type="button" @click="publishContestItem(item.id)">发布</button>
            <button class="btn-ghost" type="button" @click="rejectContestItem(item.id)">驳回</button>
          </li>
        </ul>
        <p v-else class="muted">暂无待审核条目。</p>
      </div>
      <label class="field">案例（case_studies JSON：title / lens / body）
        <textarea v-model="cms.case_studies" rows="8" class="mono"></textarea>
      </label>
      <label class="field">教学大纲（syllabus JSON）
        <textarea v-model="cms.syllabus" rows="12" class="mono"></textarea>
      </label>
      <label class="field">时间节点（timeline JSON）
        <textarea v-model="cms.timeline" rows="8" class="mono"></textarea>
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
      <h2 class="serif">添加学生</h2>
      <p class="muted">点「创建学生账号」后，生成的用户名和初始密码会出现在下方输入框里，可直接选中复制。显示名由学生登录后自行修改。</p>
      <label class="field">用户名
        <input
          :value="newUser.username"
          class="mono"
          readonly
          placeholder="点击下方按钮生成"
          @focus="$event.target.select()"
        />
      </label>
      <label class="field">初始密码
        <input
          :value="newUser.password"
          class="mono"
          readonly
          placeholder="点击下方按钮生成"
          @focus="$event.target.select()"
        />
      </label>
      <p class="filter-row">
        <button class="btn" type="button" @click="createUser">创建学生账号</button>
        <button class="btn-ghost" type="button" :disabled="!newUser.username" @click="copyCreds">一键复制</button>
      </p>

      <h2 class="serif" style="margin-top:2rem">账号列表</h2>
      <table class="table">
        <thead><tr><th>用户名</th><th>密码</th><th>显示名</th><th>角色</th><th></th></tr></thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="mono">{{ u.username }}</td>
            <td class="mono">
              <template v-if="u.role === 'student'">{{ u.password_plain || "—" }}</template>
              <span v-else class="muted">隐藏</span>
            </td>
            <td>{{ u.display_name }}</td>
            <td>{{ u.role === "coach" ? "教练" : "学生" }}</td>
            <td>
              <button
                v-if="u.role === 'student'"
                class="btn-ghost"
                type="button"
                @click="deleteUser(u)"
              >删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
