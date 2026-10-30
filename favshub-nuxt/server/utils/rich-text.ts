/**
 * 富文本渲染与消毒（2026-10-30，备注字段引入）
 *
 * ## 为什么在服务端渲染成 HTML
 *
 * 备注允许 Markdown + HTML + 图片。若把原始文本交给前端 `v-html`，
 * 就等于把 XSS 的口子开在用户可写字段上（备注是**普通用户**可填的）。
 * 两条常见路线：
 *   1. 前端 `marked` 渲染 + DOMPurify 消毒 —— 需要额外引入浏览器端消毒库，且每个消费方
 *      （页面 / 分享卡片 / 快照）都得记得消毒一次，漏一处就是漏洞；
 *   2. **服务端统一渲染 + 白名单消毒，只下发成品 HTML** —— 消毒点在唯一入口，
 *      消费方拿到的 `*_html` 天生干净，前端只需 `v-html`。
 * 本项目选 2：消毒是「一次性、不可绕过」的。
 *
 * ## 协议白名单
 *
 * 只放行 `http` / `https` / `mailto`（相对路径天然无协议，同样放行）。
 * **不放行 `data:`** —— 备注上限 2000 字，base64 图片根本塞不下，
 * 放行它只有风险没有收益。
 *
 * ## 与公告的关系
 *
 * 公告正文是**管理员**独有权限的字段，渲染路径相同（Markdown/HTML），
 * 因此共用本模块；但公告沿用「前端 marked + v-html」的既有实现，
 * 本次不动它，避免无谓回归。新代码请一律走本模块。
 */
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

/** 消毒白名单：排版、列表、代码、表格、图片、折叠块 —— 覆盖备注的真实排版需求 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'div', 'span',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
    'ul', 'ol', 'li', 'blockquote',
    'code', 'pre',
    'a', 'img',
    'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'details', 'summary',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    td: ['colspan', 'rowspan', 'align'],
    th: ['colspan', 'rowspan', 'align'],
    '*': ['class'],
  },
  // 只放行安全协议；相对路径（无协议）不受影响
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  // 不留注释（注释里塞条件注释是老 IE 套路，现代浏览器无用但仍无收益）
  allowedIframeHostnames: [],
  disallowedTagsMode: 'discard',
  transformTags: {
    // 外链一律加 rel，避免 target=_blank 的 reverse tabnabbing
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    // 不允许 iframe / script / style 等（不在白名单里，这里显式丢弃内容）
    script: () => ({ tagName: 'span', text: '' }),
    style: () => ({ tagName: 'span', text: '' }),
    iframe: () => ({ tagName: 'span', text: '' }),
    object: () => ({ tagName: 'span', text: '' }),
    embed: () => ({ tagName: 'span', text: '' }),
  },
}

/**
 * 把备注原文（Markdown，可混编 HTML）渲染成**已消毒**的 HTML。
 *
 * - 空输入 → 空串（调用方据此决定是否渲染区块）
 * - `marked` 解析失败 → 降级为「转义后的纯文本」，绝不把原文当 HTML 吐出去
 */
export function renderRichText(source: unknown): string {
  const raw = String(source ?? '')
  if (!raw.trim()) return ''

  let html: string
  try {
    html = marked.parse(raw, { async: false }) as string
  } catch {
    // 解析异常时更保守：只输出转义文本
    return escapeHtml(raw)
  }

  try {
    return sanitizeHtml(html, SANITIZE_OPTIONS)
  } catch {
    // 消毒器自身异常时宁可不渲染富文本，也不冒险下发未消毒 HTML
    return escapeHtml(raw)
  }
}

/** HTML 转义（降级路径用） */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 富文本里是否含图片（用于前端加「含图片」标记，或后续做懒加载策略） */
export function hasImage(html: string): boolean {
  return /<img\b/i.test(html)
}
