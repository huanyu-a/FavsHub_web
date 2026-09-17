# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**读者：** AI 助手与开发者（改代码、架构、CI）。  
**不是用户手册。** 产品使用、安装、部署说明见各目录 `README.md`：

| 文档 | 读者 |
|------|------|
| [README.md](README.md) | 使用者：产品是什么、最快怎么跑起来 |
| [favshub-nuxt/README.md](favshub-nuxt/README.md) | 站长 / 日常用户：网站功能与部署 |
| [favshub-ext/README.md](favshub-ext/README.md) | 扩展用户：安装与同步 |
| 本文件 + 子目录 `CLAUDE.md` | 开发者 / AI |

## 项目是什么

FavsHub = **网站 + 浏览器扩展**：书签导航、精选集、搜索引擎聚合、AI 提示词（PromptPro）。另有一个独立分发的 **AI 技能包**，供用户装到自己的 AI 助手上。

| 目录 | 职责 | 技术栈 | 详细指南 |
|------|------|--------|----------|
| [`favshub-nuxt/`](favshub-nuxt/) | 全栈网站 + API + SQLite | Nuxt 3 · Vue 3 · Pinia · Naive UI · Drizzle · better-sqlite3 | [favshub-nuxt/CLAUDE.md](favshub-nuxt/CLAUDE.md) |
| [`favshub-ext/`](favshub-ext/) | 浏览器书签同步扩展 | Vue 3 · WXT · Naive UI · TypeScript | [favshub-ext/CLAUDE.md](favshub-ext/CLAUDE.md) |
| [`favshub-data-ops/`](favshub-data-ops/) | **对外分发**的 AI 技能包（SKILL.md），走站点 `/api/ai/*` 与 `/api/mcp` | 纯文档，无构建 | [favshub-data-ops/README.md](favshub-data-ops/README.md) |
| `.github/workflows/` | 镜像 CI | 仅 `favshub-nuxt/VERSION` 变更时推 GHCR | — |

包管理器统一 **pnpm**。网站版本号：`favshub-nuxt/VERSION`。

## 跨项目数据流

```
浏览器书签树
    │  favshub-ext（Sync.vue → PUT /api/sync/bookmarks + POST /api/sync/favicons；下载走扩展内三次 diff）
    ▼
favshub-nuxt（Nitro API + SQLite）
    │  SSR 页面 /admin /collections /prompts /tokens
    ▼
用户浏览器（前台导航、精选集订阅/导入、提示词）
```

- 扩展只负责采集与同步；业务与权限全在网站服务端。
- API 前缀一律 `/api/`（不是 `/api/v1/`）。
- 认证：网站 Cookie + Bearer；扩展只带 JWT（见各子项目 CLAUDE）。

## 常用命令（速查）

```bash
# 网站
cd favshub-nuxt && pnpm install && pnpm dev     # :3000
pnpm build && pnpm preview
docker compose up -d                            # :3090

# 扩展
cd favshub-ext && pnpm install && pnpm dev      # Chrome
pnpm build                                      # → .output/chrome-mv3/
pnpm compile                                    # 类型检查
```

无仓库级 monorepo 脚本；各子目录独立 `package.json`。

## 环境变量（网站侧，摘要）

`NUXT_JWT_SECRET` · `NUXT_DB_PATH` · `NUXT_CORS_ORIGIN` · `NUXT_ADMIN_USERS` · `NUXT_TRUST_PROXY`  
完整表见 [favshub-nuxt/CLAUDE.md](favshub-nuxt/CLAUDE.md)。

## CI / 部署（摘要）

- 推送 `favshub-nuxt/VERSION` 到 `main` → GitHub Actions 构建并推 `ghcr.io/<owner>/favshub`。
- 日常功能提交**不必** bump VERSION。
- 含密码的本机部署步骤在 **`favshub-nuxt/DEPLOY.md`**（gitignore，勿提交）。

## 协作约定

- **改哪个子项目，就以该目录下的 `CLAUDE.md` 为准**；本文件只保留大图。
- 勿提交：`favshub-nuxt/data/`、JWT secret、`DEPLOY.md` 中的密钥与密码。
- 跨仓改动（扩展协议 ↔ 同步 API）需两边一起改并自测。
