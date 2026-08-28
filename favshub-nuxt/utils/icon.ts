/**
 * 图标值工具：区分「历史 emoji 数据」与「图标类名」
 *
 * 精选集/文件夹的 icon 字段历史上允许存 emoji（IconPicker 旧版），
 * 新版只提供 Remix Icon 类名。已存的 emoji 属于用户数据，必须继续渲染。
 */
const EMOJI_RE = /\p{Extended_Pictographic}/u

/** 判断图标值是否为 emoji（历史数据）。ri-、fa- 图标类名一律返回 false */
export function isEmoji(val: string): boolean {
  if (!val) return false
  if (/^(ri|fa)-/.test(val)) return false
  return EMOJI_RE.test(val)
}
