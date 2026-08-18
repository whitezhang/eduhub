# EduHub

信奥训练网站。设计见 `docs/PRD.md`、`docs/架构设计.md`、`docs/UI设计.md`。

## 本地（Windows）

需要 Node ≥ 22.5、本机 `g++`（MinGW）与 Python。

```
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:5173 。API 在 8080，由 Vite 反代 `/api`。

示例账号：`coach` / `eduhub`，`student` / `eduhub`。

只起后端：`npm start`。

## 线上

Nginx 托管 `src/rd/client/dist`，`/api/` 反代 `127.0.0.1:8080`，片段见 `src/op/nginx-api-snippet.conf`。systemd 单元 `src/op/eduhub-api.service`。发布：`src/op/deploy.sh`（`git reset --hard`，不要 `git clean`）。
