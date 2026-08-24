# 教学大纲 PRD

| 项 | 内容 |
| --- | --- |
| 页面 | `/syllabus` |
| 版本 | v1.1（§12 赛道统一框架待对齐） |
| 日期 | 2026-08-24 |
| 状态 | 已实现 |
| 实现 | `SyllabusOverview.vue`、`SyllabusNav.vue`、`useSyllabus.js` |
| 数据 | `cms.json` → `cms_blocks`；种子 `knowledge-topics.json` |
| 关联 | `PRD.md`、`PRD-首页.md`、`UI设计.md`、`PRD-登录门禁与模糊预览.md` |

---

## 1. 这是什么

**教学大纲页**：帮教练和学生看清官方赛道「考什么、怎么考」。

选一条赛道（GESP、CSP-J、CSP-S、NOIP、NOI），看：

- 这条赛道是干什么的（一句话）
- 两轮赛制差在哪（有则展示）
- 知识体系表：考哪些块、初赛/复赛是否涉及、重要度

**不是**题库、不是报名、不是发证。定好赛道和级别后，去大纲页选卷、去题库练。

### 文案原则

| 要 | 不要 |
| --- | --- |
| 短句、大白话 | 堆官方文件名、长段落 |
| 表格里写清「考什么」 | 营销、包奖、城市对比 |
| `blurb` 一句说清赛道 | 在页内复述首页 STAR |

| 字段 | 上限 |
| --- | --- |
| 赛道 `blurb` | ≤ 60 字 |
| 知识点 `points` 每条 | ≤ 40 字 |
| 对比表单元格 | ≤ 30 字 |

参考口径：NOI 2025 大纲与 CCF 公开说明；具体日期、分数线以官网为准。

---

## 2. 范围

| 做 | 不做 |
| --- | --- |
| 五条官方赛道 Tab 切换 | 图形化、Scratch 赛道 |
| 初赛 vs 复赛对比表（CSP 类） | 站内模拟赛规则页 |
| 知识体系表 + 分页 | 按知识点拆独立 URL 详情页 |
| 登录后读 CMS | 访客看真实大纲全文 |
| Studio 改 `syllabus` JSON | CSP-J vs CSP-S 对比表、自动推荐练级 |

**数据在种子里、页上未展示**（勿写进验收）：`guides` 备考段落、`gesp_csp_bridge` 免初赛规则。后续若要展示，单独开需求。

---

## 3. 权限

| 操作 | 要登录吗 |
| --- | --- |
| 访问 `/syllabus` | 否（URL 与顶栏可进） |
| 看真实大纲内容 | **是** |
| `GET /api/cms`（含 syllabus） | 是（未登录走门禁） |
| Studio 改 syllabus | 是（教练） |

未登录：主区 **模糊骨架**（`AuthWallSkeleton` variant=`syllabus`），自动弹登录框。见 `PRD-登录门禁与模糊预览.md`。

---

## 4. 导航与 URL

```text
顶栏「教学大纲」→ /syllabus?track=<slug>
```

| 赛道 slug | 顶栏 Tab 文案（缩短） | 全称 |
| --- | --- | --- |
| `gesp` | GESP | GESP 1–8 级 |
| `csp-j` | CSP-J | CSP-J 入门级 |
| `csp-s` | CSP-S | CSP-S 提高级 |
| `noip` | NOIP | NOIP |
| `noi` | NOI | NOI 入门 |

- 默认 `track=csp-j`；非法 slug 自动跳到第一条赛道。
- 兼容重定向：`/syllabus/guide`、`/syllabus/topic/:id` → `/syllabus`（保留 query）。

首页路径链路、章二按钮可带 `?track=` 深链到对应赛道。

---

## 5. 页面结构

```text
顶栏（「教学大纲」高亮）
┌─────────────────────────────────────────┐
│ 页头：教学大纲 + 赛道 Tab（横向）        │
│ 当前赛道标题 + blurb                     │
│ 知识体系 表（分页 8 条/页）              │
│ [可选] 初赛 vs 复赛 表                   │
└─────────────────────────────────────────┘
页脚
```

| 区块 | 说明 |
| --- | --- |
| 赛道 Tab | `role=tablist`；当前项高亮 |
| 标题区 | 衬线标题 + 灰色 `blurb` |
| 知识体系 | 桌面表格；手机卡片；列：类别、知识点、初赛✓、复赛✓、重要度★ |
| 初赛 vs 复赛 | `round_compare` 三列：维度 / 初赛 / 复赛（有数据时展示，在知识体系之后） |
| 分页 | 知识点 >8 条时显示上一页/下一页 |

重要度：1–5 星，`0` 显示 `—`。初赛/复赛：`true` 为 `✓`，`false` 为 `—`。

---

## 6. 数据

### CMS：`syllabus`（JSON 数组）

每条赛道：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `slug` | 是 | URL 参数，唯一 |
| `title` | 是 | 展示标题 |
| `blurb` | 否 | 一句话说明 |
| `round_compare` | 否 | `{ label, preliminary, finals }[]` |
| `topics` | 否 | 知识体系行 |
| `guides` | 否 | 种子内有，**页上未展示** |

`topics[]` 每行：

| 字段 | 说明 |
| --- | --- |
| `title` | 类别名 |
| `points` | 字符串数组，页内用 `；` 连接 |
| `preliminary` | 是否涉及初赛 |
| `finals` | 是否涉及复赛 |
| `importance` | 1–5 |
| `focus` | 种子备注，页上未展示 |

### CMS：`gesp_csp_bridge`

GESP 免 CSP 初赛规则；**页上未展示**，仅种子与 `apply-cms` 维护。

### 其他

| key | 用途 |
| --- | --- |
| `knowledge_topics` | 由 `knowledge-topics.json` 写入；`GET /api/knowledge/:id` 备用，大纲页未调用 |

### 编辑入口

Studio → 首页文案 → **教学大纲（syllabus JSON）** → `PUT /api/studio/cms`。

部署：`apply-cms.mjs` 从 `cms.json` 刷新 `syllabus`、`gesp_csp_bridge`。

---

## 7. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/cms` | 登录后返回全文；含 `syllabus`、`gesp_csp_bridge` |
| GET | `/api/knowledge/:id` | 单知识点扩展（当前大纲页未用） |

首页用 `scope=home` 只拿 `syllabus` 的 `slug/title/blurb` 做链路，不拉知识点表。

---

## 8. UI

- 布局：`.read.wide`，与题库同宽档。
- 表格：`.syll-table-compact`；桌面表 + 手机 `.syll-cards`。
- Tab：`.syll-track`，选中 `.on`。
- 骨架：与真实页同结构（标题条 + chip + 多块占位）。

详见 `UI设计.md` 顶栏与阅读区规范。

---

## 9. 异常

| 场景 | 处理 |
| --- | --- |
| 未登录 | 骨架 + 登录框，不请求 CMS |
| API 失败 | 页内 `err`，不白屏 |
| `syllabus` 空 | 无内容区（仅错误/载入态） |
| 当前赛道无 `topics` | 不展示知识体系块 |
| 无 `round_compare` | 不展示初赛复赛表 |

---

## 10. 验收

- [x] 顶栏文案为「教学大纲」，路径 `/syllabus`
- [x] 五条赛道 Tab 可切换，URL `track` 同步
- [x] 登录后展示 blurb、知识体系表、重要度与初赛/复赛标记
- [x] CSP-J/S 赛道展示「初赛 vs 复赛」
- [x] 知识点超过 8 条可分页
- [x] 未登录为模糊骨架，登录后加载真实数据
- [x] Studio 修改 `syllabus` 后刷新可见
- [x] 文案短句、无城市排名与包奖承诺

---

## 11. 与首页关系

| 首页 | 教学大纲 |
| --- | --- |
| 章二：赛道名 + 箭头链路 | 同赛道全文表 |
| CTA「打开大纲，选定赛道」 | 默认进 CSP-J 或带 `track` |
| 不讲知识点明细 | 本页专讲「考什么」 |

定赛道在大纲；练题在题库；政策与公开赛在新闻。

---

## 12. 赛道二级页统一框架（待对齐 v0.1）

> 现状问题：五条赛道**区块顺序不一致**（GESP/NOIP/NOI 无「初赛 vs 复赛」）、**CSP-J 独享** J/S 对比表、**guides / gesp_csp_bridge 有数据未展示**、知识体系表对 GESP/NOI **列语义不匹配**（初赛/复赛列无意义）。

目标：**同一套骨架、同一套样式**；差异只体现在表头文案与行数据，不靠 `slug === 'csp-j'` 硬编码。

### 12.1 统一骨架（五条赛道相同）

```text
┌─ 全局（所有赛道共用）────────────────────────────┐
│ [页头] 教学大纲 + 赛道 Tab                        │
├─ 当前赛道面板 .syll-panel ────────────────────────┤
│ ① 页头区     赛道名 + 一句话 blurb                │
│ ② 考什么     知识点表（必有区块，可分页）          │
│ ③ 怎么考     赛制/形式表（两轮赛道，有则展示）     │
│ ④ 备考要点   短条目列表（必有区块，无数据显占位）  │
│ ⑤ 相关说明   与相邻赛道关系（可选）               │
│ ⑥ 页脚注     固定一句「日期与规则以 CCF 官网为准」 │
└──────────────────────────────────────────────────┘
```

| 区块 | 样式类 | 是否必有 |
| --- | --- | --- |
| ① 页头 | `.syll-panel-head` | 是 |
| ② 考什么 | `.syll-block` + 表/卡片 + `.syll-pager` | 是 |
| ③ 怎么考 | `.syll-block` + `.syll-section-title` | 两轮赛道有 `round_compare` 时展示 |
| ④ 备考要点 | `.syll-block` + `.syll-guide` × N | 是（0 条时占位） |
| ⑤ 相关说明 | `.syll-block` + 对比表 | 否（有 `related` 才显示） |
| ⑥ 页脚注 | `.muted` 小字 | 是 |

区块之间：`border-bottom: var(--rule)`，与现有 `.syll-block` 一致。

### 12.2 赛道类型 `kind`（数据驱动表头）

每条 `syllabus[]` 增加 **`kind`**（枚举），决定 ②③ 的表头，不再按 slug 分支。

| kind | 赛道 | ③ 怎么考 | ② 考什么表头 |
| --- | --- | --- | --- |
| `cert` | GESP | 三列：**维度 \| 说明** | **级别 \| 知识点 \| 重要度** |
| `two_round` | CSP-J、CSP-S | 三列：**维度 \| 第一轮 \| 第二轮** | **类别 \| 知识点 \| 第一轮 \| 第二轮 \| 重要度** |
| `oi` | NOIP、NOI | 三列：**维度 \| 说明** | **模块 \| 知识点 \| 机试 \| 重要度** |

- `cert` / `oi` 不出现「初赛/复赛」字样。
- `topics[].preliminary` / `finals` 在 `cert` 下可废弃，改看 `importance`；`oi` 下 `finals=true` 即「机试 ✓」。

### 12.3 数据字段（对齐后）

| 字段 | 说明 |
| --- | --- |
| `kind` | `cert` / `two_round` / `oi` |
| `blurb` | ① 区副文案，≤ 60 字 |
| `format_rows` | ③ 区统一行：`{ label, col_a, col_b? }`；`two_round` 用 `col_a`=第一轮、`col_b`=第二轮；`cert`/`oi` 只用 `col_a` 作说明 |
| `topics` | ② 区，结构不变 |
| `guides` | ④ 区：`{ title, body }[]`，**最多展示 3 条**，`body` ≤ 80 字 |
| `related` | ⑤ 区：`{ title, rows: [{ label, left, right }] }`；单块对比表 |

**迁移**：

- `round_compare` → `format_rows`（`preliminary`→`col_a`，`finals`→`col_b`）。
- `gesp_csp_bridge` → 写入 GESP 赛道的 `related`（见下表）。

| 赛道 | ⑤ `related.title` | 数据来源 |
| --- | --- | --- |
| GESP | 和 CSP 的关系 | `gesp_csp_bridge` |
| NOIP | 和 CSP-S 的关系 | 新写 3–4 行种子 |
| NOI | 和 NOIP / 省选的关系 | 新写 3–4 行种子 |

### 12.4 各赛道内容清单（对齐后应一致）

| 赛道 | ① blurb 要点 | ③ 怎么考（示例行） | ② 考什么（行数级） | ④ 备考要点（条数） |
| --- | --- | --- | --- | --- |
| GESP | 按级认证，按级练 | 形式、频次、通过线 | 4 行（1–2…7–8 级） | 1–2 |
| CSP-J | 两轮、独立报名 | 形式、时长、满分、结果 | 6+ 行，分页 | 2–3（题型提示） |
| CSP-S | 比 J 难、含多选 | 同上 | 6+ 行，分页 | 2–3 |
| NOIP | 一天四题、省资格 | 题数、时长、资格来源 | 1–3 模块 | 1 |
| NOI | 省选后、决赛风 | 题数、时长、阶段 | 1–3 模块 | 1 |

### 12.5 样式规范（与现 CSS 对齐）

| 元素 | 类名 / 规则 |
| --- | --- |
| 赛道 Tab | `.syll-track` / `.on` |
| 区块 | `.syll-block`，最后一块 `border-bottom: none` |
| 小节标题 | `.syll-section-title`（统一字号、上边距） |
| 分页条 | `.syll-section-bar` + `.syll-page-sum` |
| 桌面表 | `.table.desk.syll-table.syll-table-compact`，`<thead>` + `<tbody>` |
| 手机 | `.mobile.syll-cards` + `.syll-card` |
| 备考条 | `.syll-guide`：标题 `strong` + 正文 `muted` |
| 重要度 | `.syll-stars`，`★` 1–5 |
| 勾选列 | `.mono`，`✓` / `—` |

**禁止**：某赛道单独加区块、单独表样式、或 `if (slug === 'csp-j')` 插表。

### 12.6 空态与占位（统一）

| 区块 | 无数据时 |
| --- | --- |
| ② 考什么 | 灰字：`知识点清单待补充。` |
| ③ 怎么考 | 灰字：`赛制说明待补充，以 CCF 官网为准。` |
| ④ 备考要点 | 灰字：`暂无备考提示。` |
| ⑤ 相关说明 | **不展示区块**（无 `related`） |

### 12.7 实现顺序（对齐后开发）

1. PRD 本节约稿定稿 → 改 `cms.json` 字段与种子。
2. `SyllabusOverview.vue`：按 `kind` 渲染五段骨架；抽 `SyllabusFormatTable` / `SyllabusTopicTable` / `SyllabusGuides` / `SyllabusRelated`。
3. 迁移脚本或一次性改种子；`apply-cms` 兼容旧 `round_compare` 只读迁移。
4. 更新 §10 验收：五条赛道区块数量与顺序一致。

### 12.8 待你确认的问题

1. **⑤ 相关说明**：GESP 展示与 CSP 衔接；CSP-J/S 不再做组间对比表。（建议：各赛道底部 `related` 仅 GESP/NOIP/NOI。）
2. **④ 备考要点**：CSP 种子里 `guides` 很长（含子知识点），是否只展示顶层 2–3 条，细节以后链题库？（建议：页上只 3 条短句。）
3. **GESP ② 怎么考**：用固定 4 行（形式/频次/语言/衔接）还是自由 `format_rows`？（建议：自由行，种子 4 行。）
4. **NOIP/NOI ③ 表**：目前只有 1 行「考查方向」，是否拆成 3 模块（DP/图论/实现）以填满框架？（建议：拆 3 行，视觉与其他赛道一致。）

确认后把本节标为「已定稿」，并升 PRD 版本号。

