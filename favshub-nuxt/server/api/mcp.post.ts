/**
 * POST /api/mcp — MCP（Model Context Protocol）Streamable HTTP 端点
 *
 * 协议：JSON-RPC 2.0，支持 initialize / tools/list / tools/call / ping。
 * 鉴权：与 `/api/ai/*` 同一套 PAT（`Authorization: Bearer favs_ai_...`），
 *       鉴权失败返回 HTTP 401；工具级错误按 JSON-RPC 约定放在 body 的 `error` 字段。
 * 数据：全部落到 `ai-service.ts`，与 REST 端点行为完全一致（含 dry_run / confirm / 越权隔离）。
 */
import { readBody } from 'h3'
import { getRawDb } from '../database'
import { authenticateAi, auditAi, requireScope, type AiScope, type AiTokenRow } from '../utils/ai-auth'
import {
  listBookmarks, createBookmarks, updateBookmark, deleteBookmark,
  listFolders, createFolder, updateFolder, deleteFolder,
  listPrompts, getPromptDetail, createPrompt, updatePrompt, deletePrompt,
  listTags, createTag, deleteTag,
  listTokenDeals, createTokenDeal, updateTokenDeal, deleteTokenDeal,
} from '../utils/ai-service'
import { safeErrorMessage } from '../utils/sanitize'

const SERVER_NAME = 'favshub-ai-data-ops'
const SERVER_VERSION = '1.0.0'

/** 工具定义：name → { scope, handler } */
interface ToolDef {
  name: string
  scope: AiScope
  description: string
  inputSchema: Record<string, any>
  run: (db: any, token: AiTokenRow, args: any) => any
}

const obj = (props: Record<string, any>, required: string[] = []) => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
})

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const bool = (description: string) => ({ type: 'boolean', description })
const strArr = (description: string) => ({ type: 'array', items: { type: 'string' }, description })

const CONFIRM = bool('删除确认标志，必须为 true，否则操作被拒绝')
const DRY_RUN = bool('预演模式：仅返回将执行的变更，不写入数据库')

const TOOLS: ToolDef[] = [
  // ── 元信息 ───────────────────────────────────────────────────
  {
    name: 'describe',
    scope: 'read',
    description: '获取接口能力清单、字段字典、规则与错误码。建议首次接入时先调用。',
    inputSchema: obj({}),
    run: (db, token) => {
      const user = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(token.user_id) as any
      return {
        name: SERVER_NAME,
        caller: { user_id: token.user_id, username: user?.username, is_admin: !!user?.is_admin, scopes: String(token.scopes).split(',') },
        tools: TOOLS.map(t => ({ name: t.name, scope: t.scope, description: t.description })),
        rules: {
          batch_limit: 50,
          dry_run: '写操作支持 dry_run:true 预演，不落库',
          delete_requires_confirm: true,
          isolation: '所有操作限定于令牌所属用户；越权返回 404',
          visibility: '非管理员写入的数据强制 login_required=1（仅自己可见）',
        },
      }
    },
  },
  {
    name: 'get_stats',
    scope: 'read',
    description: '获取当前账号各资源的数量概览（书签/文件夹/提示词/标签/通告）与最近条目。',
    inputSchema: obj({}),
    run: (db, token) => {
      const uid = token.user_id
      const one = (sql: string) => (db.prepare(sql).get(uid) as any).c as number
      return {
        counts: {
          bookmarks: one('SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = ?'),
          folders: one('SELECT COUNT(*) AS c FROM folders WHERE user_id = ?'),
          prompts: one('SELECT COUNT(*) AS c FROM prompts WHERE user_id = ? AND deleted_at IS NULL'),
          prompts_trashed: one('SELECT COUNT(*) AS c FROM prompts WHERE user_id = ? AND deleted_at IS NOT NULL'),
          tags: one('SELECT COUNT(*) AS c FROM tags WHERE user_id = ?'),
          token_deals: one('SELECT COUNT(*) AS c FROM token_deals WHERE user_id = ?'),
        },
      }
    },
  },

  // ── 书签 ─────────────────────────────────────────────────────
  {
    name: 'list_bookmarks',
    scope: 'read',
    description: '查询书签列表，支持关键词、文件夹、标签池过滤与分页。',
    inputSchema: obj({ q: str('关键词（匹配标题或 URL）'), folder_id: str('文件夹 ID'), label: str("标签：'' 为精选集公共池，'web' 为个人书签"), limit: num('每页条数，默认 100，最大 500'), page: num('页码，从 1 开始') }),
    run: (db, token, args) => listBookmarks(db, token.user_id, args || {}),
  },
  {
    name: 'create_bookmarks',
    scope: 'write',
    description: '创建一条或多条书签（单次最多 50 条）。支持 dry_run 预演。同一 URL 重复会报 409。',
    inputSchema: obj({
      items: { type: 'array', description: '书签数组；也可直接用 title/url 传单条', items: obj({ title: str('标题（必填）'), url: str('URL（必填，仅 http/https）'), folder_id: num('所属文件夹 ID'), icon: str('图标 URL'), description: str('描述'), label: str('标签'), need_proxy: bool('是否需要代理') }) },
      title: str('单条模式的标题'),
      url: str('单条模式的 URL'),
      folder_id: num('单条模式的文件夹 ID'),
      description: str('单条模式的描述'),
      dry_run: DRY_RUN,
    }),
    run: (db, token, args) => createBookmarks(db, token.user_id, args || {}),
  },
  {
    name: 'update_bookmark',
    scope: 'write',
    description: '更新指定书签的字段（仅自己名下的书签）。支持 dry_run 预演。',
    inputSchema: obj({ id: num('书签 ID（必填）'), title: str('标题'), url: str('URL'), folder_id: num('文件夹 ID'), description: str('描述'), icon: str('图标 URL'), sort_order: num('排序值'), need_proxy: bool('是否需要代理'), dry_run: DRY_RUN }, ['id']),
    run: (db, token, args) => updateBookmark(db, token.user_id, args?.id, args || {}),
  },
  {
    name: 'delete_bookmark',
    scope: 'delete',
    description: '删除指定书签（仅自己名下的）。必须携带 confirm:true；建议先用 dry_run 预演并向用户确认。',
    inputSchema: obj({ id: num('书签 ID（必填）'), confirm: CONFIRM, dry_run: DRY_RUN }, ['id', 'confirm']),
    run: (db, token, args) => deleteBookmark(db, token.user_id, args?.id, args || {}),
  },

  // ── 文件夹 ───────────────────────────────────────────────────
  {
    name: 'list_folders',
    scope: 'read',
    description: '查询自己的书签文件夹列表。',
    inputSchema: obj({ q: str('按名称过滤') }),
    run: (db, token, args) => listFolders(db, token.user_id, args || {}),
  },
  {
    name: 'create_folder',
    scope: 'write',
    description: '创建书签文件夹，支持指定父文件夹形成多级结构。',
    inputSchema: obj({ name: str('文件夹名称（必填，≤128）'), parent_id: num('父文件夹 ID'), icon: str('图标'), login_required: bool('是否仅登录可见（非管理员恒为私有）'), dry_run: DRY_RUN }, ['name']),
    run: (db, token, args) => createFolder(db, token.user_id, args || {}),
  },
  {
    name: 'update_folder',
    scope: 'write',
    description: '更新文件夹名称、父级、排序或图标。',
    inputSchema: obj({ id: num('文件夹 ID（必填）'), name: str('新名称'), parent_id: num('新父文件夹 ID'), sort_order: num('排序值'), icon: str('图标'), login_required: bool('是否仅登录可见'), dry_run: DRY_RUN }, ['id']),
    run: (db, token, args) => updateFolder(db, token.user_id, args?.id, args || {}),
  },
  {
    name: 'delete_folder',
    scope: 'delete',
    description: '删除文件夹。不会删除其中的书签（书签会解除归属），子文件夹会上提。必须携带 confirm:true。',
    inputSchema: obj({ id: num('文件夹 ID（必填）'), confirm: CONFIRM, dry_run: DRY_RUN }, ['id', 'confirm']),
    run: (db, token, args) => deleteFolder(db, token.user_id, args?.id, args || {}),
  },

  // ── 提示词 ───────────────────────────────────────────────────
  {
    name: 'list_prompts',
    scope: 'read',
    description: '查询自己的提示词列表（不含回收站），返回标题与正文。',
    inputSchema: obj({ q: str('关键词（匹配标题或描述）'), folder_id: str('提示词文件夹 ID'), favorite: bool('仅收藏'), limit: num('每页条数，默认 100'), page: num('页码') }),
    run: (db, token, args) => listPrompts(db, token.user_id, args || {}),
  },
  {
    name: 'get_prompt',
    scope: 'read',
    description: '获取单个提示词详情（含标签与完整正文）。',
    inputSchema: obj({ id: str('提示词 ID（必填）') }, ['id']),
    run: (db, token, args) => ({ prompt: getPromptDetail(db, token.user_id, String(args?.id)) }),
  },
  {
    name: 'create_prompt',
    scope: 'write',
    description: '创建提示词，自动生成初始版本 1.0.0。',
    inputSchema: obj({ title: str('标题（必填，≤256）'), content: str('提示词正文（必填，≤100000）'), description: str('描述（≤2000）'), folder_id: str('提示词文件夹 ID'), tags: strArr('标签 ID 数组'), dry_run: DRY_RUN }, ['title', 'content']),
    run: (db, token, args) => createPrompt(db, token.user_id, args || {}),
  },
  {
    name: 'update_prompt',
    scope: 'write',
    description: '更新提示词；正文变更会自动创建新版本并自增版本号。restore:true 可从回收站恢复。',
    inputSchema: obj({ id: str('提示词 ID（必填）'), title: str('标题'), content: str('正文'), description: str('描述'), folder_id: str('文件夹 ID'), tags: strArr('标签 ID 数组'), is_favorite: bool('收藏'), restore: bool('从回收站恢复'), change_note: str('变更说明'), dry_run: DRY_RUN }, ['id']),
    run: (db, token, args) => updatePrompt(db, token.user_id, args?.id, args || {}),
  },
  {
    name: 'delete_prompt',
    scope: 'delete',
    description: '删除提示词。默认软删除（进回收站可恢复）；permanent:true 才物理删除。必须携带 confirm:true。',
    inputSchema: obj({ id: str('提示词 ID（必填）'), confirm: CONFIRM, permanent: bool('是否物理删除'), dry_run: DRY_RUN }, ['id', 'confirm']),
    run: (db, token, args) => deletePrompt(db, token.user_id, args?.id, args || {}),
  },

  // ── 标签 ─────────────────────────────────────────────────────
  {
    name: 'list_tags',
    scope: 'read',
    description: '查询自己的标签列表（含每个标签关联的提示词数量）。',
    inputSchema: obj({}),
    run: (db, token) => listTags(db, token.user_id),
  },
  {
    name: 'create_tag',
    scope: 'write',
    description: '创建标签（同名幂等，返回已存在的那条）。',
    inputSchema: obj({ name: str('标签名（必填，≤64）'), color: str('颜色'), dry_run: DRY_RUN }, ['name']),
    run: (db, token, args) => createTag(db, token.user_id, args || {}),
  },
  {
    name: 'delete_tag',
    scope: 'delete',
    description: '删除标签（仅管理员）。必须携带 confirm:true。',
    inputSchema: obj({ id: str('标签 ID（必填）'), confirm: CONFIRM, dry_run: DRY_RUN }, ['id', 'confirm']),
    run: (db, token, args) => deleteTag(db, token.user_id, args?.id, args || {}),
  },

  // ── Token 白嫖通告 ───────────────────────────────────────────
  {
    name: 'list_token_deals',
    scope: 'read',
    description: '查询 Token 白嫖通告（公开的已审核通告 + 自己发布的全部）。',
    inputSchema: obj({ q: str('关键词（匹配服务商或标题）'), region: str('cn | global'), quality: str('上上品 | 上品 | 中品 | 下品 | 下下品'), mine: bool('仅自己发布的'), limit: num('每页条数，默认 50'), page: num('页码') }),
    run: (db, token, args) => listTokenDeals(db, token.user_id, args || {}),
  },
  {
    name: 'create_token_deal',
    scope: 'write',
    description: '发布 Token 白嫖通告。管理员发布直接上线，普通用户发布进入待审核。',
    inputSchema: obj({ provider: str('服务商名称（必填，≤60）'), title: str('通告标题（必填，≤120）'), url: str('领取地址（必填，http/https）'), call_url: str('API 调用地址'), quota: str('免费额度描述'), models: strArr('支持的模型列表'), region: str('cn | global'), quality: str('品质分级'), source_tag: str('official | relay | community'), expires_at: num('有效期毫秒时间戳，null 为永久'), note: str('备注'), dry_run: DRY_RUN }, ['provider', 'title', 'url']),
    run: (db, token, args) => createTokenDeal(db, token.user_id, args || {}),
  },
  {
    name: 'update_token_deal',
    scope: 'write',
    description: '更新 Token 白嫖通告（作者或管理员）。**部分更新**：只传需要修改的字段，未传字段保持原值 —— 无需回填全部字段。',
    inputSchema: obj({ id: str('通告 ID（必填）'), provider: str('服务商名称（≤60）'), title: str('通告标题（≤120）'), url: str('领取地址（http/https）'), call_url: str('API 调用地址'), quota: str('免费额度描述'), models: strArr('支持的模型列表（整体替换）'), region: str('cn | global'), quality: str('品质分级'), source_tag: str('official | relay | community'), expires_at: num('有效期毫秒时间戳，null 为永久'), note: str('备注'), dry_run: DRY_RUN }, ['id']),
    run: (db, token, args) => updateTokenDeal(db, token.user_id, args?.id, args || {}),
  },
  {
    name: 'delete_token_deal',
    scope: 'delete',
    description: '删除 Token 白嫖通告（作者或管理员）。必须携带 confirm:true。',
    inputSchema: obj({ id: str('通告 ID（必填）'), confirm: CONFIRM, dry_run: DRY_RUN }, ['id', 'confirm']),
    run: (db, token, args) => deleteTokenDeal(db, token.user_id, args?.id, args || {}),
  },
]

const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]))

/** MCP tools/list 输出（剔除内部 run 函数） */
function toolDescriptors() {
  return TOOLS.map(t => ({
    name: t.name,
    description: `[需要 ${t.scope} 权限] ${t.description}`,
    inputSchema: t.inputSchema,
  }))
}

export default defineEventHandler(async (event) => {
  // 鉴权（失败由 error-handler 统一转 401 JSON）
  const token = authenticateAi(event)

  const body = await readBody(event).catch(() => null)
  const id = body?.id ?? null
  const method = body?.method

  const ok = (result: any) => ({ jsonrpc: '2.0', id, result })
  const rpcError = (code: number, message: string, data?: any) => ({
    jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) },
  })

  // 通知类消息（无 id）无需响应
  if (typeof method === 'string' && method.startsWith('notifications/')) {
    return null
  }

  try {
    if (method === 'initialize') {
      return ok({
        protocolVersion: String(body?.params?.protocolVersion || '2025-06-18'),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: 'FavsHub 数据操作 MCP 服务。所有操作限定于令牌所属用户。写操作建议先传 dry_run:true 预演；删除必须传 confirm:true。',
      })
    }

    if (method === 'ping') return ok({})

    if (method === 'tools/list') return ok({ tools: toolDescriptors() })

    if (method === 'tools/call') {
      const name = body?.params?.name
      const args = body?.params?.arguments || {}
      const tool = TOOL_MAP.get(String(name))
      if (!tool) {
        auditAi(event, 400)
        return rpcError(-32602, `未知工具：${name}`)
      }

      // 工具级 scope 校验（按工具所需权限，与 REST 端点一致）
      ;(event.context as any).aiScope = tool.scope
      requireScope(event, tool.scope)

      const result = await tool.run(getRawDb(), token, args)
      auditAi(event, 200)
      return ok({
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      })
    }

    auditAi(event, 400)
    return rpcError(-32601, `不支持的方法：${method}`)
  } catch (err: any) {
    const status = Number(err?.statusCode) || 500
    auditAi(event, status)

    const message = safeErrorMessage(err, '执行失败')
    // JSON-RPC 错误码：参数类 → -32602；权限/业务类 → -32000；服务器错误 → -32603
    const code = status === 400 ? -32602 : (status >= 500 ? -32603 : -32000)
    return rpcError(code, message, { http_status: status })
  }
})
