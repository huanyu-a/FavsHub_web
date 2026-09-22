/**
 * GET /api/ai/describe — AI 自描述端点
 *
 * 用途：AI 客户端接入后的**第一个**调用。返回能力清单、字段字典、规则与错误码，
 * 使客户端无需预装任何知识即可正确使用其余端点。
 *
 * 鉴权：PAT（read scope 即可）。
 */
import { getRawDb } from '../../database'
import { defineAiHandler, parseScopes, AI_BATCH_LIMIT } from '../../utils/ai-auth'
import { isUserAdmin } from '../../utils/ai-service'
import { SKILL_MANIFEST_META } from '../../utils/skill-manifest'

export default defineAiHandler('read', async (_event, token) => {
  const db = getRawDb()
  const user = db.prepare('SELECT id, username, nickname, is_admin FROM users WHERE id = ?').get(token.user_id) as any
  // 与 ai-service 共用同一判定（含 NUXT_ADMIN_USERS 运维旁路），避免此处与写操作权限认知不一致
  const isAdmin = isUserAdmin(db, token.user_id)

  const counts = {
    bookmarks: (db.prepare('SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = ?').get(token.user_id) as any).c,
    folders: (db.prepare('SELECT COUNT(*) AS c FROM folders WHERE user_id = ?').get(token.user_id) as any).c,
    prompts: (db.prepare('SELECT COUNT(*) AS c FROM prompts WHERE user_id = ? AND deleted_at IS NULL').get(token.user_id) as any).c,
    tags: (db.prepare('SELECT COUNT(*) AS c FROM tags WHERE user_id = ?').get(token.user_id) as any).c,
    token_deals: (db.prepare('SELECT COUNT(*) AS c FROM token_deals WHERE user_id = ?').get(token.user_id) as any).c,
  }

  return {
    name: 'favshub-ai-data-ops',
    description: 'FavsHub 数据操作接口。所有数据操作严格限定在令牌所属用户的数据范围内。',

    auth: {
      scheme: 'Bearer',
      token_prefix: 'favs_ai_',
      header: 'Authorization: Bearer favs_ai_...',
      note: '本接口只接受访问令牌（PAT），不接受登录凭证（JWT）。令牌在站点「管理后台 → API 令牌」创建。',
    },

    caller: {
      user_id: user?.id ?? token.user_id,
      username: user?.username ?? '',
      nickname: user?.nickname ?? '',
      is_admin: isAdmin,
      scopes: parseScopes(token.scopes),
      counts,
    },

    scopes: {
      read: '查询数据（GET 类端点）',
      write: '创建与更新数据（POST / PUT）',
      delete: '删除数据（DELETE，必须显式授予，且仅管理员可创建含此权限的令牌）',
      hierarchy: 'read < write < delete，高等级自动包含低等级能力',
    },

    rules: {
      batch_limit: AI_BATCH_LIMIT,
      dry_run: '所有写操作支持 dry_run:true —— 仅返回将执行的变更（changes）而不落库。建议先预演，确认后再正式执行。',
      delete_requires_confirm: true,
      delete_confirm_hint: '删除端点必须在请求体携带 {"confirm": true}，否则返回 400。',
      batch_delete: '不支持批量删除，每次只能删除一条。',
      isolation: '所有查询与写入强制限定于令牌所属用户；操作他人资源返回 404（不区分「不存在」与「无权限」，避免信息泄露）。',
      visibility: '非管理员写入的数据强制 login_required=1（仅自己可见）；管理员可选择公开。',
      soft_delete: '提示词删除为软删除（进入回收站），可用 restore:true 恢复；permanent:true 才物理删除。',
      prompts_ownership: 'AI 只能操作自己创建的提示词，不开放编辑管理员发布的公共提示词。',
      tags_delete: '删除标签仅管理员可执行（与站点既有规则一致）。',
      token_deals_status: '管理员发布的通告直接上线（approved）；普通用户发布进入待审核（pending）。',
      patch_semantics: '更新端点（PUT）一律为**部分更新**：只传需要修改的字段，未传字段保持原值。无需先 GET 再回填全部字段。',
      deal_edits: '**通告内容允许所有人修改，但需经「通告作者」或「管理员」审核。** 修改他人通告必须走建议通道（POST /api/ai/token-deals/:id/edits 或工具 submit_token_deal_edit），不能直接 UPDATE；作者是本人通告的审核人，可直接改自己的（PUT），编辑即刻生效。审核权限 = 通告作者或管理员，管理员可审核所有用户的建议。建议通过前通告内容不受影响。',
      card_render: 'GET /api/ai/token-deals/:id/card.png 返回 PNG 二进制（非 JSON），用 curl -o 落盘即可。三种风格：magazine（编辑杂志，默认）/ neon（深色终端）/ clay（暖阳陶土）。渲染有缓存（按通告 updated_at 失效），调试时可加 refresh=1 强制重绘。未审核通过的通告仅作者与管理员可取（403）。',
    },

    resources: {
      bookmarks: {
        table: 'bookmarks',
        fields: {
          id: '整数，主键',
          title: '字符串，必填，≤256',
          url: '字符串，必填，≤2048，仅允许 http/https（拒绝 javascript:/data:/vbscript:/file:）',
          folder_id: '整数，可空，须属于自己',
          icon: '字符串，可空，≤2048',
          description: '字符串，可空，≤2000',
          label: "字符串，''=精选集公共池（仅管理员），默认 'web'=个人书签",
          login_required: '0/1，可见性；非管理员写入恒为 1',
          need_proxy: '0/1，是否需要代理访问',
          sort_order: '整数，排序',
          created_at: '毫秒时间戳',
          updated_at: '毫秒时间戳',
        },
        unique: '同一用户下 url 唯一（重复创建返回 409）',
      },
      folders: {
        table: 'folders',
        fields: {
          id: '整数，主键', name: '字符串，必填，≤128', parent_id: '整数，可空，支持多级',
          icon: '字符串，可空', sort_order: '整数', login_required: '0/1',
        },
        note: '删除文件夹不会删除其内书签，而是把书签的 folder_id 置空、子文件夹上提到被删文件夹的父级。',
      },
      prompts: {
        table: 'prompts',
        fields: {
          id: '字符串 UUID', title: '字符串，必填，≤256', content: '字符串，必填，≤100000',
          description: '字符串，可空，≤2000', folder_id: '字符串，可空（prompt_folders.id）',
          tags: '字符串数组，标签 ID 列表', is_favorite: '0/1', login_required: '0/1',
          version_count: '整数，内容变更时自增', current_version: '字符串，如 1.0.0',
          deleted_at: '毫秒时间戳，非空表示在回收站',
        },
        note: '内容变更会自动创建新版本记录并自增版本号。',
      },
      tags: {
        table: 'tags',
        fields: { id: '字符串 UUID', name: '字符串，必填，≤64', color: '字符串，可空' },
        note: '同名标签返回已存在的那条（幂等），不会重复创建。',
      },
      token_deals: {
        table: 'token_deals',
        fields: {
          id: '字符串', provider: '字符串，必填，≤60', title: '字符串，必填，≤120',
          url: '字符串，必填，http(s)，≤500', call_url: '字符串，可空，http(s)，≤500',
          quota: '字符串，可空，≤200', models: '字符串数组，≤20 项', region: 'cn | global',
          quality: '上上品 | 上品 | 中品 | 下品 | 下下品', source_tag: 'official | relay | community',
          expires_at: '毫秒时间戳或 null（null=永久）', note: '字符串，可空，≤500',
          status: 'pending | approved | rejected', pinned: '0/1，仅管理员可置顶',
        },
        note: '列表默认返回公开的 approved 通告 + 自己发布的全部（含 pending）。',
      },
      token_deal_edits: {
        table: 'token_deal_edits',
        fields: {
          id: '字符串，建议 ID',
          deal_id: '字符串，关联的通告 ID',
          user_id: '整数，提交建议的用户',
          payload: '对象，**只含被修改的字段**（字段级 patch），非整条通告快照',
          comment: '字符串，可空，≤200，提交说明',
          status: 'pending | approved | rejected',
          reviewer_id: '整数或 null，审核人',
          reject_reason: '字符串，可空，≤200',
          created_at: '毫秒时间戳', updated_at: '毫秒时间戳',
        },
        note: '审核时以「通告当前内容」为底合并 payload，因此建议提交后主表其他字段的改动不会被建议覆盖回旧值；diff 相对当前内容实时计算，已无差异时 is_noop=true。',
      },
    },

    endpoints: [
      { method: 'GET', path: '/api/ai/describe', scope: 'read', desc: '本端点：能力清单与字段字典' },
      { method: 'GET', path: '/api/ai/stats', scope: 'read', desc: '各资源计数盘点' },

      { method: 'GET', path: '/api/ai/bookmarks', scope: 'read', params: ['q', 'folder_id', 'label', 'limit', 'page'] },
      { method: 'POST', path: '/api/ai/bookmarks', scope: 'write', body: '{ title, url, folder_id?, icon?, description?, label?, login_required?, need_proxy? } 或 { items: [...], dry_run? }' },
      { method: 'PUT', path: '/api/ai/bookmarks/:id', scope: 'write', body: '{ title?, url?, folder_id?, icon?, description?, label?, sort_order?, need_proxy?, login_required?, dry_run? }' },
      { method: 'DELETE', path: '/api/ai/bookmarks/:id', scope: 'delete', body: '{ confirm: true, dry_run? }' },

      { method: 'GET', path: '/api/ai/folders', scope: 'read', params: ['q'] },
      { method: 'POST', path: '/api/ai/folders', scope: 'write', body: '{ name, parent_id?, icon?, login_required?, dry_run? }' },
      { method: 'PUT', path: '/api/ai/folders/:id', scope: 'write', body: '{ name?, parent_id?, icon?, sort_order?, login_required?, dry_run? }' },
      { method: 'DELETE', path: '/api/ai/folders/:id', scope: 'delete', body: '{ confirm: true, dry_run? }' },

      { method: 'GET', path: '/api/ai/prompts', scope: 'read', params: ['q', 'folder_id', 'favorite', 'limit', 'page'] },
      { method: 'GET', path: '/api/ai/prompts/:id', scope: 'read', desc: '提示词详情（含标签）' },
      { method: 'POST', path: '/api/ai/prompts', scope: 'write', body: '{ title, content, description?, folder_id?, tags?, login_required?, dry_run? }' },
      { method: 'PUT', path: '/api/ai/prompts/:id', scope: 'write', body: '{ title?, content?, description?, folder_id?, tags?, is_favorite?, restore?, dry_run? }' },
      { method: 'DELETE', path: '/api/ai/prompts/:id', scope: 'delete', body: '{ confirm: true, permanent?, dry_run? }' },

      { method: 'GET', path: '/api/ai/tags', scope: 'read' },
      { method: 'POST', path: '/api/ai/tags', scope: 'write', body: '{ name, color?, dry_run? }' },
      { method: 'DELETE', path: '/api/ai/tags/:id', scope: 'delete', body: '{ confirm: true, dry_run? }', note: '仅管理员' },

      { method: 'GET', path: '/api/ai/token-deals', scope: 'read', params: ['q', 'region', 'quality', 'mine', 'limit', 'page'] },
      { method: 'POST', path: '/api/ai/token-deals', scope: 'write', body: '{ provider, title, url, call_url?, quota?, models?, region?, quality?, source_tag?, expires_at?, note?, dry_run? }' },
      { method: 'PUT', path: '/api/ai/token-deals/:id', scope: 'write', body: '{ provider?, title?, url?, call_url?, quota?, models?, region?, quality?, source_tag?, expires_at?, note?, dry_run? }', note: '**部分更新**：只传要改的字段，未传保持原值；作者或管理员。修改他人通告请改用建议通道' },
      { method: 'DELETE', path: '/api/ai/token-deals/:id', scope: 'delete', body: '{ confirm: true, dry_run? }', note: '作者或管理员' },
      { method: 'GET', path: '/api/ai/token-deals/:id/card.png', scope: 'read', params: ['style=magazine|neon|clay', 'refresh=0|1'], returns: 'image/png 二进制（900×1200）', note: '生成通告分享卡片，与网页分享面板同一份绘制逻辑；响应头 x-card-style / x-card-cached 便于核对' },

      { method: 'POST', path: '/api/ai/token-deals/:id/edits', scope: 'write', body: '{ provider?, title?, url?, call_url?, quota?, models?, region?, quality?, source_tag?, expires_at?, note?, comment?, dry_run? }', note: '**提交修改建议**（任何登录用户可对任意已公开通告提交）。只传要改字段；同一人对同一通告只保留一条待审建议，再次提交即覆盖。需经作者或管理员审核才生效' },
      { method: 'GET', path: '/api/ai/token-deals/:id/edits', scope: 'read', params: ['status=pending|approved|rejected|all'], note: '作者与管理员见全部；其他用户仅见自己提交的建议' },
      { method: 'GET', path: '/api/ai/token-deal-edits', scope: 'read', params: ['limit', 'page'], note: '**待我审核**的建议：管理员见全部用户，普通用户见自己通告上他人提交的；仅 pending' },
      { method: 'POST', path: '/api/ai/token-deal-edits/:id/review', scope: 'write', body: '{ action: "approve" | "reject", reason?, dry_run? }', note: '审核建议；权限为通告作者或管理员（管理员可审所有用户的）' },
      { method: 'DELETE', path: '/api/ai/token-deal-edits/:id', scope: 'write', note: '撤回自己提交的建议（仅待审状态）' },

      { method: 'POST', path: '/api/mcp', scope: '按工具', desc: 'MCP（JSON-RPC 2.0）通道：initialize / tools/list / tools/call，与 REST 端点等价' },
    ],

    skill: {
      name: SKILL_MANIFEST_META.name,
      version: SKILL_MANIFEST_META.version,
      site_version: SKILL_MANIFEST_META.site_version,
      manifest_url: SKILL_MANIFEST_META.manifest_path,
      source: SKILL_MANIFEST_META.source,
      latest_changes: SKILL_MANIFEST_META.latest_changes,
      update_hint: `把本技能包 frontmatter 的 version 与上方的 version 比较：低于则说明有新版本，请求 ${SKILL_MANIFEST_META.manifest_path} 可一次拿到全部文件的最新内容（清单内 files[].content）。更新前请先向用户说明变更并获得同意。`,
      note: '该清单为公开静态资源，不含令牌或任何用户数据。',
    },

    errors: {
      400: '参数非法（缺字段、超长、危险 URL、批量超限、缺 confirm）',
      401: '缺少令牌 / 令牌类型错误 / 令牌无效或已吊销',
      403: 'scope 不足 / 越权写入他人文件夹 / 非管理员执行管理员专属操作',
      404: '资源不存在或不属于当前令牌（两者不区分）',
      409: '唯一约束冲突（如同一用户下 URL 重复）',
      429: '超出限频（每令牌 600 次/分钟）',
      500: '服务器内部错误（细节不返回给客户端）',
    },

    recommended_workflow: [
      '1. 先调用 GET /api/ai/describe 了解能力与字段',
      '2. 写操作先带 dry_run:true 预演，把 changes 呈现给用户确认',
      '3. 确认后去掉 dry_run 正式执行',
      '4. 删除前必须向用户确认，并携带 confirm:true',
    ],
  }
})
