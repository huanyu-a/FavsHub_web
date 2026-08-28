# 安全审查报告

> reviewer: 安全审计 · 2026-07-28

## [CRITICAL]

### S1. `FolderTreeItem.vue` 使用 `v-html` 渲染用户可控内容
- 文件：`components\sidebar\FolderTreeItem.vue:74`
- `v-html` 渲染文件夹名称，若名称含恶意脚本可触发 XSS。
- 修复：改用 `{{ folder.name }}` 文本插值；若需富文本，用 DOMPurify 过滤。

## [MAJOR]

### S2. CSP 包含 `unsafe-eval` 且生产未移除
- 文件：`nuxt.config.ts:50`
- 注释说 dev 模式 HMR 需要，但 Nuxt 3.15+ 生产已不需要。
- 修复：区分 dev/prod CSP，生产去掉 `unsafe-eval`。

### S3. JWT 密钥强度依赖环境变量
- 文件：`server/utils/jwt.ts`、`nuxt.config.ts`
- `NUXT_JWT_SECRET` 空时回退到 `data/.jwt-secret` 或自动生成 48 字节。若管理员未设置，重启后密钥变化导致所有 token 失效。
- 修复：启动时若密钥为空，强制要求设置或警告；密钥持久化。

### S4. 管理员权限检查顺序风险
- 文件：`server/utils/auth.ts:56-78`
- `requireAdmin` 先查 `NUXT_ADMIN_USERS` 再查数据库。若环境变量被误配置，可能绕过数据库 is_admin。
- 修复：双重校验，两者都记录审计日志。

### S5. 错误信息泄露
- 文件：`server/plugins/error-handler.ts`
- 生产环境可能返回完整错误堆栈给客户端。
- 修复：生产环境只返回通用错误码，详细错误仅记服务端日志。

## [MINOR]

### S6. `login_required` 继承计算 O(n²)
- 文件：`server/api/bookmarks/index.get.ts:18-58`
- 双重遍历 + `find`，1000 文件夹时 ≈ 200 万次比较。
- 修复：用 `Map` 替换 `find`。

### S7. 备份文件下载未校验权限边界
- 文件：`server/api/admin/backup/download.get.ts`
- 仅校验管理员，但未校验是否可访问其他管理员的备份。
- 修复：校验 backup 文件归属或全局共享白名单。

### S8. `rate-limit.ts` 清理定时器无插件作用域保护
- 文件：`server/utils/rate-limit.ts:20-26`
- 模块顶层执行，多实例/热更新时可能泄漏定时器。
- 修复：移入 `defineNitroPlugin`，`SIGTERM` 时清除。

---

**总结：严重 1 | 重要 4 | 轻微 4 | 合计 9**
