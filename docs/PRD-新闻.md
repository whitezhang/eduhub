# 新闻页 PRD（政策 + 公开赛）

| 项 | 内容 |
| --- | --- |
| 页面 | `/news`（默认 `/news/policy`） |
| 版本 | v1.5 |
| 日期 | 2026-08-24 |
| 状态 | 已实现 |
| 实现 | `News.vue`、`policy-sync.mjs`、`contest-sync.mjs`、`policy_items` / `contest_items` 表 |
| 关联 | `PRD-首页.md`、`UI设计.md`、`PRD-登录门禁与模糊预览.md` |

---

## 1. 这是什么

独立公开页，集中展示与信息学/编程相关的**国家政策**和**一线公开赛**。

- **政策 tab**：国家层面官方文件，按出台时间排列，附可点击链接和客观摘要。
- **公开赛 tab**：一线赛事与活动，按举办时间描述排列，附可点击链接和客观摘要。

首页 STAR 讲背景；本页承担**出处全集与持续更新**，供家长与教练核验。

**原则**：只链官方或权威域；摘要客观不营销；抓取在服务端缓存，打开页面不实时爬外站。

---

## 2. 范围

| 做 | 不做 |
| --- | --- |
| 顶栏「新闻」入口 + 页内二级标签 | 首页内嵌政策/公开赛长列表 |
| 政策时间线列表 | 非官方自媒体、机构解读 |
| 公开赛活动列表 | 站内模拟赛（见题库/Studio） |
| 服务端定时抓取 + 本地缓存 | 用户访问时直连外站 |
| 字段：日期/时间、标题、链接、摘要 | 全文转载、PDF 内嵌 |
| Studio 审核发布 | 地方政策、校内通知 |

---

## 3. 权限

| 操作 | 要登录吗 |
| --- | --- |
| 访问 `/news`、`/news/policy`、`/news/contests` | 否 |
| `GET /api/cms?scope=policy` / `scope=contests` | 否（限速） |
| 后台触发抓取 / 审核 | 是（运营） |

---

## 4. 导航

```text
EduHub | 首页 | 新闻 | 教学大纲 | 题库 | 外部资料 | 榜单 | [管理]
                 └─ 政策 | 公开赛
```

| 项 | 规格 |
| --- | --- |
| 顶栏文案 | `新闻` |
| 顶栏路径 | `/news`（默认重定向 `/news/policy`） |
| 位置 | 紧挨「首页」右侧 |
| 高亮 | `route.path.startsWith('/news')` |
| 兼容 | `/policy` → `/news/policy` |

| 二级标签 | 路径 | 数据来源 |
| --- | --- | --- |
| 政策 | `/news/policy` | `policy_items`（`status=published`） |
| 公开赛 | `/news/contests` | `contest_items`（`status=published`） |

### 与首页分工

| 位置 | 内容 |
| --- | --- |
| 首页 S1/S2 | 只保留叙事文字 + 段末链到新闻 |
| 新闻 · 政策 | 国家政策出处全集 |
| 新闻 · 公开赛 | 一线赛事/活动出处全集 |

---

## 5. 页面结构

```text
顶栏（「新闻」高亮）
┌──────────────────────────────────────┐
│ 页头：新闻                            │
│ 二级标签：政策 | 公开赛               │
│ —— 政策 —— 导语 + 时间线 + synced_at │
│ —— 公开赛 —— 导语 + 列表 + synced_at │
└──────────────────────────────────────┘
页脚
```

| 区块 | 说明 |
| --- | --- |
| 页头 | 标题「新闻」；衬线样式与首页章标题一致 |
| 二级标签 | 当前 tab 底边高亮 |
| 政策导语 | `教育部、国务院政策库等官方文件，按出台时间排列。` |
| 政策列表 | `date` 升序；文末显示 `synced_at` |
| 公开赛导语 | `一线城市与公开赛事活动，按年内举办时间排列。` |
| 公开赛列表 | `when` 展示；可选 `showcase_label` / `showcase_url` |
| 布局 | 单栏 `.read`，与首页阅读宽度一致 |

---

## 6. 列表项规格

### 政策

| 字段 | 说明 |
| --- | --- |
| `date` | `YYYY-MM`，排序键 |
| `title` | 政策标题 |
| `url` | 官方链接；`target="_blank"` |
| `summary` | ≤ 160 字客观摘要 |

### 公开赛

| 字段 | 说明 |
| --- | --- |
| `when` | 举办时间描述（库内列 `when_label`） |
| `title` / `url` / `summary` | 同政策 |
| `showcase_label` / `showcase_url` | 可选，成果/展厅链 |

---

## 7. 数据

### 表 `policy_items`

| 列 | 说明 |
| --- | --- |
| `url` | 官方链接（唯一键） |
| `date` | `YYYY-MM` |
| `title` / `summary` | 标题 / 摘要 |
| `source` | `moe` / `gov` |
| `status` | `published` / `pending` / `rejected` |
| `fetched_at` | 最近抓取时间 |

公开页只读 `status=published`。表为空时，从 `cms.json` 的 `policy_feed` 导入种子。

### 表 `contest_items`

| 列 | 说明 |
| --- | --- |
| `url` | 活动链接（唯一键） |
| `when_label` | 举办时间描述 |
| `title` / `summary` | 标题 / 摘要 |
| `showcase_label` / `showcase_url` | 可选成果链 |
| `source` | `moe` / `ccf` / `gov` / `jyb` / `media` |
| `status` | `published` / `pending` / `rejected` |
| `fetched_at` | 最近抓取时间 |

公开页只读 `status=published`。表为空时，从 `cms.json` 的 `star_s_links.tier1` 导入种子（7 条，`published`）。

### CMS 块

| key | 用途 |
| --- | --- |
| `policy_intro` | 政策页导语 |
| `policy_synced_at` | 政策最近成功同步时间 |
| `policy_sync_meta` | 政策同步日志 |
| `contests_intro` | 公开赛页导语 |
| `contest_synced_at` | 公开赛最近成功同步时间 |
| `contest_sync_meta` | 公开赛同步日志 |

`star_s_links.tier1` 仍保留在种子 JSON，供首期迁移与人工维护参考；公开页不再直接读 CMS 中的 tier1。

---

## 8. 抓取与同步

### 政策

实现：`src/rd/server/policy-sync.mjs`；CLI：`npm run policy-sync`。

| 站点 | 抓什么 |
| --- | --- |
| `moe.gov.cn` | 教育部文件（课标、AI 教育等） |
| `www.gov.cn` | 国务院政策库 |

关键词：信息科技、人工智能教育、义务教育课程、教育数字化等。

### 公开赛

实现：`src/rd/server/contest-sync.mjs`；CLI：`npm run contest-sync`。

| 来源 | 抓什么 |
| --- | --- |
| `moe.gov.cn`（was5 搜索） | 青少年编程、信息学奥林匹克、创客、人工智能大赛、GESP 等 |
| `gesp.ccf.org.cn` | GESP 公告 |
| `ccf.org.cn` | CCF 新闻/通知 |

**域名白名单**：`*.gov.cn`、`moe.gov.cn`、`ccf.org.cn`、`*.jyb.cn`、`thepaper.cn`、`qq.com`、`hangzhou.com.cn`、`shqsnkj.com` 等。

**标题关键词**：编程、信息学、GESP、CSP、NOI、创客、黑客松、人工智能、机器人、科技创新、等级认证等。

抓取到的新 URL 默认 `pending`；种子 tier1 在首次迁移或同步时写入为 `published`。`when_label` / `showcase_*` 由种子或运营在 Studio 维护，自动抓取不覆盖已发布条目的展示字段。

### 通用规则

| 项 | 说明 |
| --- | --- |
| 触发 | 生产每日 06:00（政策）/ 06:30（公开赛，UTC+8）+ 手动 |
| 新条目 | 默认 `pending`，Studio 审核后 `published` |
| 摘要 | 正文首段截取 ≤160 字 |
| 失败 | 展示上次缓存 + 超 48h 提示「可能不是最新」 |

### 环境配置（`src/op/conf/{env}.json`）

| 配置块 | 测试 | 生产 |
| --- | --- | --- |
| `policySync.scheduler` | `false` | `true` |
| `contestSync.scheduler` | `false` | `true` |
| `fetchLive` | `true` | `true` |
| `newStatus` | `pending` | `pending` |

数据目录：`src/rd/server/data/`（必须在仓库内）。

- 测试库：`data/runtime/test/eduhub.db`
- 生产库：`data/runtime/prod/eduhub.db`
- 本地 `npm run dev` 默认 `EDUHUB_ENV=test`，不自动定时抓取。

---

## 9. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/cms?scope=policy` | 政策列表 + 导语 + `synced_at` |
| GET | `/api/cms?scope=contests` | 公开赛列表 + 导语 + `synced_at` |
| POST | `/api/studio/policy-sync` | 运营手动触发政策同步 |
| POST | `/api/studio/contest-sync` | 运营手动触发公开赛同步 |
| GET | `/api/studio/policy-items` | 政策条目（含 pending） |
| GET | `/api/studio/contest-items` | 公开赛条目（含 pending） |
| POST | `/api/studio/policy-items/:id/publish` | 发布政策条目 |
| POST | `/api/studio/contest-items/:id/publish` | 发布公开赛条目 |

---

## 10. 异常

| 场景 | 处理 |
| --- | --- |
| 列表为空 | 空态文案 |
| 单条缺 `url` | 跳过 |
| API 失败 | 页内错误，不白屏 |
| 抓取连续失败 | 展示缓存 + 超 48h 提示「可能不是最新」 |
| 外链失效 | 不自动删；运营在 Studio 修正或驳回 |

---

## 11. 验收

- [x] 顶栏「新闻」在首页右侧；默认进 `/news/policy`
- [x] 二级标签「政策」「公开赛」可切换
- [x] 无需登录即可访问
- [x] 政策列表按 `date` 升序；公开赛展示 `contest_items`
- [x] 首页 S1/S2 无长列表，有链到新闻的入口
- [x] `/policy` 重定向到 `/news/policy`
- [x] 政策抓取写入 `policy_items`；新 URL 默认 `pending`
- [x] 公开赛抓取写入 `contest_items`；新 URL 默认 `pending`
- [x] 测试不自动定时；生产每日 06:00 / 06:30

### 首期种子

**政策（7 条）**：2022-03 义务教育课标 · 2022-04 国务院政策库收录 · 2024-02 AI 教育基地 · 2024-12 加强中小学 AI 教育 · 2025-04 教育数字化 · 2025-05 AI 通识指南 · 2026-04 「人工智能+教育」行动计划。完整 URL 见 `cms.json` → `policy_feed`。

**公开赛（7 条 tier1）**：见 `cms.json` → `star_s_links.tier1`（含 `when`、成果展示链等）。
