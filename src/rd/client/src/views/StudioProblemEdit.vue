<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import StatementView from "./StatementView.vue";

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const saving = ref(false);
const msg = ref("");
const err = ref("");
const showPreview = ref(true);

const form = reactive({
  code: "",
  title: "",
  source: "",
  difficulty: "",
  type: "traditional",
  languagesText: "cpp,python",
  time_ms: 1000,
  memory_mb: 128,
  io_mode: "stdin",
  full_score: 100,
  published: true,
  review_note: "",
  statement: "",
  sample_in: "",
  sample_out: "",
  sample_note: "",
  choiceAnswer: "",
  options: [
    { key: "A", text: "" },
    { key: "B", text: "" },
    { key: "C", text: "" },
    { key: "D", text: "" },
  ],
  testcases: [],
});

const pid = computed(() => Number(route.params.id));

function fill(p) {
  form.code = p.code || "";
  form.title = p.title || "";
  form.source = p.source || "";
  form.difficulty = p.difficulty || "";
  form.type = p.type || "traditional";
  form.languagesText = Array.isArray(p.languages) ? p.languages.join(",") : "cpp,python";
  form.time_ms = p.time_ms ?? 1000;
  form.memory_mb = p.memory_mb ?? 128;
  form.io_mode = p.io_mode || "stdin";
  form.full_score = p.full_score ?? 100;
  form.published = Boolean(p.published);
  form.review_note = p.review_note || "";
  form.statement = p.statement || "";
  form.sample_in = p.sample_in || "";
  form.sample_out = p.sample_out || "";
  form.sample_note = p.sample_note || "";
  const choice = p.choice || {};
  form.choiceAnswer = choice.answer || "";
  const opts = Array.isArray(choice.options) && choice.options.length
    ? choice.options.map((o) => ({ key: o.key || "", text: o.text || "" }))
    : [
        { key: "A", text: "" },
        { key: "B", text: "" },
        { key: "C", text: "" },
        { key: "D", text: "" },
      ];
  form.options = opts;
  form.testcases = (p.testcases || []).map((t) => ({
    seq: t.seq,
    score: t.score,
    is_sample: Boolean(t.is_sample),
    input: t.input || "",
    output: t.output || "",
  }));
}

async function load() {
  loading.value = true;
  err.value = "";
  msg.value = "";
  try {
    const p = await api(`/api/studio/problems/${pid.value}`);
    fill(p);
  } catch (e) {
    err.value = e.message;
  } finally {
    loading.value = false;
  }
}

function addOption() {
  const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const used = new Set(form.options.map((o) => o.key));
  const key = [...keys].find((k) => !used.has(k)) || `O${form.options.length + 1}`;
  form.options.push({ key, text: "" });
}

function removeOption(i) {
  form.options.splice(i, 1);
}

function addCase() {
  const next = form.testcases.reduce((m, t) => Math.max(m, Number(t.seq) || 0), 0) + 1;
  form.testcases.push({ seq: next, score: 0, is_sample: false, input: "", output: "" });
}

function removeCase(i) {
  form.testcases.splice(i, 1);
}

function buildBody() {
  const languages = form.languagesText
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const body = {
    code: form.code,
    title: form.title,
    source: form.source,
    difficulty: form.difficulty,
    type: form.type,
    languages,
    time_ms: Number(form.time_ms) || 0,
    memory_mb: Number(form.memory_mb) || 0,
    io_mode: form.io_mode,
    full_score: Number(form.full_score) || 100,
    published: form.published ? 1 : 0,
    review_note: form.review_note,
    statement: form.statement,
    sample_in: form.sample_in,
    sample_out: form.sample_out,
    sample_note: form.sample_note,
    testcases: form.testcases.map((t, i) => ({
      seq: Number(t.seq) || i + 1,
      score: Number(t.score) || 0,
      is_sample: t.is_sample ? 1 : 0,
      input: t.input,
      output: t.output,
    })),
  };
  if (form.type === "choice") {
    body.choice = {
      options: form.options.map((o) => ({ key: String(o.key || "").trim(), text: String(o.text || "") })),
      answer: String(form.choiceAnswer || "").trim(),
    };
  } else {
    body.choice = null;
  }
  return body;
}

async function save() {
  saving.value = true;
  msg.value = "";
  err.value = "";
  try {
    const res = await api(`/api/studio/problems/${pid.value}`, {
      method: "PUT",
      body: buildBody(),
    });
    msg.value = res.message || "已保存";
    await load();
  } catch (e) {
    err.value = e.message;
  } finally {
    saving.value = false;
  }
}

watch(() => route.params.id, load);
onMounted(load);
</script>

<template>
  <div class="wide">
    <p class="muted">
      <router-link to="/studio">← 管理</router-link>
      ·
      <router-link :to="`/problems/${pid}`">预览做题页</router-link>
    </p>
    <h1 class="serif">编辑题目</h1>
    <p v-if="loading" class="muted">载入中</p>
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="msg" class="ok">{{ msg }}</p>
    <template v-if="!loading && !err">
      <div class="filter-row">
        <button class="btn" type="button" :disabled="saving" @click="save">{{ saving ? "保存中…" : "保存" }}</button>
        <button class="btn-ghost" type="button" @click="showPreview = !showPreview">
          {{ showPreview ? "隐藏预览" : "显示预览" }}
        </button>
        <button class="btn-ghost" type="button" @click="router.push('/studio')">返回列表</button>
      </div>
      <p class="muted">保存后立刻写入本机题库，并更新仓库内 catalog 文件。上线：git add / commit / push，再在服务器 deploy。</p>

      <div class="edit-grid">
        <div>
          <h2 class="serif">基本信息</h2>
          <label class="field">题号 <input v-model="form.code" class="mono" /></label>
          <label class="field">标题 <input v-model="form.title" /></label>
          <label class="field">来源 <input v-model="form.source" /></label>
          <label class="field">难度 <input v-model="form.difficulty" /></label>
          <label class="field">类型
            <select v-model="form.type">
              <option value="traditional">编程</option>
              <option value="choice">选择 / 判断</option>
            </select>
          </label>
          <label class="field">语言（逗号分隔） <input v-model="form.languagesText" class="mono" /></label>
          <label class="field">时限 ms <input v-model.number="form.time_ms" type="number" /></label>
          <label class="field">内存 MB <input v-model.number="form.memory_mb" type="number" /></label>
          <label class="field">IO <input v-model="form.io_mode" class="mono" /></label>
          <label class="field">满分 <input v-model.number="form.full_score" type="number" /></label>
          <label class="field">
            <span><input v-model="form.published" type="checkbox" /> 已发布</span>
          </label>
          <label class="field">备注 <textarea v-model="form.review_note" rows="2"></textarea></label>

          <h2 class="serif">题面</h2>
          <label class="field">
            <textarea v-model="form.statement" rows="16" class="mono statement-edit"></textarea>
          </label>

          <template v-if="form.type === 'choice'">
            <h2 class="serif">选项与答案</h2>
            <label class="field">标准答案（选项键） <input v-model="form.choiceAnswer" class="mono" /></label>
            <div v-for="(opt, i) in form.options" :key="i" class="option-edit">
              <input v-model="opt.key" class="mono opt-key" />
              <textarea v-model="opt.text" rows="2"></textarea>
              <button class="btn-ghost" type="button" @click="removeOption(i)">删</button>
            </div>
            <button class="btn-ghost" type="button" @click="addOption">加选项</button>
          </template>

          <template v-else>
            <h2 class="serif">样例</h2>
            <label class="field">样例输入 <textarea v-model="form.sample_in" rows="4" class="mono"></textarea></label>
            <label class="field">样例输出 <textarea v-model="form.sample_out" rows="4" class="mono"></textarea></label>
            <label class="field">样例说明 <textarea v-model="form.sample_note" rows="2"></textarea></label>

            <h2 class="serif">测试点</h2>
            <p class="muted">is_sample 勾选表示样例测例。保存时会重写 runtime 测例文件。</p>
            <div v-for="(tc, i) in form.testcases" :key="i" class="case-edit">
              <div class="filter-row">
                <label>序号 <input v-model.number="tc.seq" type="number" class="mono short" /></label>
                <label>分值 <input v-model.number="tc.score" type="number" class="mono short" /></label>
                <label><input v-model="tc.is_sample" type="checkbox" /> 样例</label>
                <button class="btn-ghost" type="button" @click="removeCase(i)">删</button>
              </div>
              <label class="field">输入 <textarea v-model="tc.input" rows="3" class="mono"></textarea></label>
              <label class="field">输出 <textarea v-model="tc.output" rows="3" class="mono"></textarea></label>
            </div>
            <button class="btn-ghost" type="button" @click="addCase">加测试点</button>
          </template>

          <div class="filter-row" style="margin-top:1.5rem">
            <button class="btn" type="button" :disabled="saving" @click="save">{{ saving ? "保存中…" : "保存" }}</button>
          </div>
        </div>
        <aside v-if="showPreview" class="edit-preview">
          <h2 class="serif">题面预览</h2>
          <div class="solve-stem" style="border:1px solid var(--rule)">
            <StatementView :text="form.statement" />
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>
