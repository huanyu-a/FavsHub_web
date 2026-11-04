/**
 * 剪贴板写入 —— 带降级的统一实现（2026-11-04）
 *
 * 为什么需要这个工具（真实 bug，不是预防性优化）：
 *   `navigator.clipboard` 只在 **secure context**（https 或 localhost）可用。
 *   一旦通过 http 访问 —— 内网调试、局域网 192.168.x、临时 IP 如 172.x ——
 *   `navigator.clipboard` 就是 `undefined`，沿用原写法会：
 *     · 抛 TypeError（`.writeText` of undefined），或
 *     · 被 `?.` 静默吞掉，用户点了按钮**毫无反应**
 *   本站两种访问方式都存在，用户报的「详情页链接无法复制」就是这个原因。
 *
 * 三级降级：
 *   ① navigator.clipboard.writeText —— 现代浏览器 + secure context
 *   ② document.execCommand('copy') + 临时 textarea —— 已废弃，但 http 下是唯一可用路径
 *   ③ 返回 false，由调用方决定怎么提示（**不假装成功**）
 *
 * 用法：
 *   import { copyText } from '~/utils/clipboard'
 *
 *   if (await copyText(url)) toast('已复制')
 *   else toast('复制失败，请手动复制', 'err')
 */

/** 临时 textarea + execCommand 的兜底实现。成功返回 true。 */
function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined') return false

  const ta = document.createElement('textarea')
  ta.value = text
  // 放在视口内但不可见：position:fixed + opacity:0 避免页面跳动；
  // 不能用 display:none —— 那样 select() 选不中，复制会是空内容。
  ta.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;padding:0;border:0;z-index:-1'
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')

  document.body.appendChild(ta)
  try {
    ta.select()
    ta.setSelectionRange(0, text.length)
    // execCommand 返回 boolean；老 Safari 也可能抛异常，一并兜住
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    // 必须清理：残留 textarea 会占据文档流焦点，还会被下一轮 select() 抢走
    document.body.removeChild(ta)
  }
}

/**
 * 把文本写入剪贴板。
 *
 * @returns `true` = 确认写入成功；`false` = 两条路都失败，调用方应提示用户手动复制。
 *
 * 注意：**不要在 SSR 阶段调用**。函数内部已判 `typeof window`，
 * 服务端会直接返回 false 而不是崩溃（组件里通常只在 onMounted / 事件回调中调）。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  if (typeof window === 'undefined') return false

  // ① 标准 API（secure context 才有）
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 权限被拒（用户点了"阻止"）或非 secure context 的伪装实现 —— 走 ②
    }
  }

  // ② execCommand 兜底
  if (execCommandCopy(text)) return true

  // ③ 都失败
  return false
}