# 登录门禁与模糊预览 PRD

| 项 | 内容 |
| --- | --- |
| 依据 | 防抓取登录墙迭代；[`docs/PRD.md`](PRD.md) 角色与 IA |
| 版本 | v0.1 |
| 日期 | 2026-08-22 |
| 状态 | 已实现 |
| 原则 | 访客可感知「点进了哪一页」，但看不到真实数据；登录后无感恢复 |

---

## 1. 背景与问题

当前实现（`router.js` + `AppShell.vue`）：

- 访客点击 **大纲 / 题库 / 外部资料 / 榜单** 时，`requiresAuth` 拦截后 **重定向回首页**，并弹出登录框。
- 顶栏高亮仍停留在 **首页**，与访客心智（「我已经点进题库了」）不一致。
- 弹层背后是完整首页内容，**没有「此区需登录」的预览感**，也不像常见产品的软门禁（如 ProductHunt 登录墙）。

**目标**：访客点受保护入口时，**顶栏切换到目标 Tab**，**主区展示模糊预览**，登录框叠在最上层；登录成功后加载真实数据并去掉模糊。

---

## 2. 范围

**本期做**

| 项 | 说明 |
| --- | --- |
| 顶栏状态 | URL 与 `router-link-active` 与访客点击的目标一致 |
| 模糊预览 | 主内容区模糊 + 略降透明度，登录框与顶栏不模糊 |
| 自动弹登录 | 进入受保护页且未登录时自动打开登录框（保留 `loginReturnTo`） |
| 登录后恢复 | 登录成功 → 关闭弹层 → 拉 API → 去模糊 |
| 覆盖页面 | `/syllabus`、`/problems` 及子路由、`/external`、`/progress` 及 `/progress/:id` |

**本期不做**

- 在模糊层展示真实题面/榜单数据的「假数据」截图（防泄露）
- 独立注册流程、找回密码
- 全站强制登录（首页仍公开，见既有策略）

---

## 3. 用户故事

1. **访客点题库**：地址栏变为 `/problems`，顶栏「题库」高亮；列表区为模糊占位；登录框出现；关闭登录框仍停留在 `/problems` 模糊态，可点「首页」离开。
2. **访客登录成功**：弹层关闭，题库列表正常加载，模糊消失。
3. **已登录用户**：行为与现在一致，无模糊、无额外弹层。
4. **访客在首页点顶栏「登录」**：仅弹登录框，**不**进入模糊预览（无目标受保护页）。

---

## 4. 交互与视觉

### 4.1 状态机

```text
访客 + 公开页（/）           → 正常首页，无模糊
访客 + 受保护页（/problems） → authWall：顶栏目标高亮 + 主区模糊 + loginOpen
已登录 + 任意页              → 正常
```

### 4.2 顶栏

- **高亮规则**：完全由 Vue Router 当前 `route.path` 决定（现有 `router-link-active` 逻辑不变）。
- **不再**因未登录把路由重定向到 `/`，以保证高亮与 URL 一致。
- 访客在模糊态仍可点击「首页」等公开链接；点击其他受保护链接则切换 URL 与对应占位/模糊布局。

### 4.3 主内容模糊

| 元素 | 处理 |
| --- | --- |
| `<main class="main">` 内页面根节点 | `filter: blur(6px)`（可配置 token），`opacity: 0.85`，`pointer-events: none`，`user-select: none` |
| 顶栏 `<header class="topbar">` | 不模糊 |
| 登录弹层 `.modal-bg` | 不模糊；半透明遮罩 `rgba(0,0,0,.35)` 盖住主区 |
| 页脚 | 与主区一同模糊（或可选不模糊，默认随主区） |

**占位内容**（模糊下层，禁止请求真实 API）：

- 通用：**骨架屏**（灰块 + 标题条），与页面布局大致同构即可。
- 题库：左栏题单 + 右侧卡片列表骨架。
- 大纲：侧栏轨道 + 正文段落骨架。
- 外部资料 / 榜单：表格/列表行骨架。

不使用真实 CMS/题目 JSON 渲染后再模糊（避免数据先进 DOM 再藏）。

### 4.4 登录弹层

- 文案：标题「登录」；副文案「登录后查看大纲 / 题库 / …」（按 `route.meta.sectionTitle` 或路径映射）。
- 关闭：点遮罩或 Esc → `loginOpen = false`，**保持**当前受保护 URL 与模糊预览（可再次点顶栏「登录」）。
- 登录成功：关闭弹层 → 触发各页 `load()` → `authWall` 清除。

### 4.5 无障碍

- 登录弹层：`role="dialog"`、`aria-modal="true"`（已有），模糊主区加 `aria-hidden="true"`。
- 尊重 `prefers-reduced-motion`：减弱或关闭 blur 动画，仅保留遮罩。

---

## 5. 技术方案（实现要点）

### 5.1 路由

**现况**：`beforeEach` 未登录时 `return { path: "/" }`。

**改为**：

```text
未登录 + requiresAuth：
  session.openLogin(to.fullPath)
  session.authWall = true
  return true   // 允许进入目标路由
```

首页、`/studio`（教练自行鉴权）逻辑不变。

### 5.2 会话状态（`stores/session.js`）

| 字段 | 含义 |
| --- | --- |
| `loginOpen` | 登录弹层是否显示（已有） |
| `loginReturnTo` | 登录成功后 `router.push`（已有） |
| `authWall` | 主区是否处于「未登录模糊预览」 |

规则：`authWall = requiresAuth 路由 && !user`（可用 getter `showAuthWall` 派生，减少手动同步）。

### 5.3 布局（`AppShell.vue`）

```text
<main :class="{ 'main--auth-wall': showAuthWall }">
  <slot />
</main>
```

`showAuthWall` 为 true 时给 `<main>` 加模糊 class；登录弹层仍在 `AppShell` 最上层。

### 5.4 受保护页面

统一模式（可抽 `useAuthWall()` composable）：

```text
onMounted:
  if (!user) return          // 不请求 API
  await load()

watch(user):
  if (user) await load()
```

模板：

```text
<AuthWallSkeleton v-if="!user" />   <!-- 骨架，被父级 blur -->
<真实内容 v-else />
```

或单组件内：`v-if="user"` 真实内容 / `v-else` 骨架。

### 5.5 API

- 未登录时 **禁止** 受保护页发起 `/api/problems` 等请求（依赖前端守卫；后端仍 401，双重保险）。
- `api.js` 收到 `LOGIN_REQUIRED` 时仅 `openLogin()`，**不**再额外 toast（避免与 authWall 重复）。

### 5.6 文件改动清单（开发时）

| 文件 | 改动 |
| --- | --- |
| `router.js` | 取消重定向首页；允许进入受保护路由 |
| `stores/session.js` | `authWall` / `showAuthWall` getter |
| `layout/AppShell.vue` | main 模糊 class；弹层副文案按路由 |
| `components/AuthWallSkeleton.vue` | 通用 + 按页 variant |
| `views/Problems.vue` 等 | 未登录不拉数 + 骨架 |
| `styles.css` | `.main--auth-wall`、骨架样式 |

---

## 6. 验收标准

1. 未登录从首页点「题库」：URL 为 `/problems`，顶栏「题库」高亮，主区模糊骨架，登录框自动弹出。
2. 关闭登录框：仍停留在 `/problems`，仍为模糊态，顶栏仍高亮题库。
3. 登录成功：模糊消失，题库数据正常展示，无整页闪回首页。
4. 已登录用户进入上述页面：无模糊、无自动弹登录。
5. 未登录在首页点右上角「登录」：仅弹层，URL 仍为 `/`，主区不模糊。
6. 开发者工具 Network：模糊态下无受保护 API 200 响应（无数据泄露）。

---

## 7. 与防抓取策略的关系

| 层 | 职责 |
| --- | --- |
| 前端 authWall | 体验：顶栏一致 + 模糊预览 + 登录引导 |
| 后端 `guardRequireLogin` | 安全：未登录 API 一律 401 |
| JS Challenge | 仍作用于匿名可访问接口（如 `GET /api/cms?scope=home`） |

三者互补：模糊层**不替代**后端鉴权。

---

## 8. 排期建议

| 步骤 | 内容 | 估时 |
| --- | --- | --- |
| 1 | 路由 + session 状态 | 0.5d |
| 2 | AppShell 模糊 + 弹层文案 | 0.5d |
| 3 | 骨架组件 + 4 个受保护页接入 | 1d |
| 4 | 自测与移动端顶栏菜单 | 0.5d |

**合计约 2.5 人日。**

---

## 9. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 骨架与真实布局差太多 | 每页一个 variant，不要求像素级一致 |
| blur 性能（低端机） | `prefers-reduced-motion` 降级为仅遮罩不 blur |
| 深链直接打开 `/problems` | 同样走 authWall + 弹登录，与点击导航一致 |
| SEO | 受保护页本就不索引正文；骨架无敏感文本 |

---

## 10. 后续可选

- 登录框内一句「为什么需要登录」（防爬说明，一句话）。
- 教练 `/studio` 未登录时单独门禁（本期仍靠 API 403）。
