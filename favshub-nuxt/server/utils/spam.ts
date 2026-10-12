/**
 * 灌水 / 广告内容黑名单（游客通告、游客评测、登录用户评测共用）
 *
 * 只收「无论谁写都不该出现在评测/通告里」的硬特征，不做模糊匹配，避免误伤正常表达
 * （例如「加微信」在白嫖通告里就是正当的引流）。
 */
const SPAM_PATTERNS = [
  /加\s*(微信|VX|vx|QQ|qq|群)/,
  /(免费|大量|专业)\s*(代|刷|接)\s*(充|单|量)/,
  /http[^\s]{0,4}:\/\/[^\s]*\.(?:top|xyz|icu|buzz|click)\b/i,
  /(点击|访问)\s*下方?\s*(链接|广告)/,
  /(博彩|赌场|色情|代开发票|办证)/,
]

/** 文本命中灌水/广告黑名单 */
export function hasSpamText(text: string): boolean {
  if (!text) return false
  return SPAM_PATTERNS.some(re => re.test(text))
}
