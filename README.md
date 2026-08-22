# EduHub

信奥训练网站。设计见 `docs/PRD.md`、`docs/架构设计.md`、`docs/UI设计.md`；题库抓取见 `docs/题库抓取.md`。

## 本地（Windows）

需要 Node ≥ 22.5、本机 `g++`（MinGW）与 Python。

```
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:5171 。API 在 8081（避开 blog 的 8080），由 Vite 反代 `/api`。

示例账号（仅本地/文档，勿写在站点上）：`coach` / `eduhub`。学生账号由教练在「管理 → 账号」一键生成（随机用户名与初始密码），显示名由学生登录后自行修改。无公开注册。

只起后端：`npm start`。

## 线上

前端：本机 `npm run build:client` → 仓根 `output/`（可提交）。Nginx 托管该目录到 `edu.jsoner.cn`；`deploy-client.sh` 只 rsync，不在服务器上 Vite。题库 seed（`src/rd/server/data/seed/gesp`、`csp-j`）进 git，`deploy-server.sh` 会 `--skip-crawl` 导入。线上 `/api/` 反代 `127.0.0.1:8081`（blog 已占 8080），见 `src/op/nginx-api-snippet.conf`。systemd：`src/op/eduhub-api.service`。发布：`src/op/deploy.sh`（`git reset --hard`，不要 `git clean`）。
