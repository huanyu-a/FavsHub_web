/**
 * FavsHub 前端安全工具函数
 * 防止 XSS 攻击的通用转义和清理函数
 */

/**
 * HTML 转义 — 将特殊字符替换为 HTML 实体
 * 用于安全地将用户数据插入 HTML 文本内容
 * @param {*} str - 要转义的值（会被转为字符串）
 * @returns {string} 转义后的安全字符串
 */
function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 属性值转义 — 用于 HTML 属性上下文（如 title、alt、data-* 等）
 * 转义 &, <, >, ", ' 字符
 * @param {*} str - 要转义的值
 * @returns {string} 转义后的安全字符串
 */
function escapeAttr(str) {
  if (str == null) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * URL 清理 — 只允许 http/https 协议，防止 javascript: 等危险协议
 * @param {*} url - 要清理的 URL
 * @returns {string} 安全的 URL，危险协议返回空字符串
 */
function sanitizeUrl(url) {
  if (url == null) return '';
  const s = String(url).trim();
  // 允许 http://, https://, // (协议相对), 以及相对路径
  if (/^(https?:\/\/|\/\/|\/[^\/]|[^\/])/i.test(s)) {
    // 排除 javascript:, data:, vbscript: 等危险协议
    if (/^(javascript|data|vbscript|blob):/i.test(s)) return '';
    return s;
  }
  return '';
}

// 挂载到全局
window.escapeHtml = escapeHtml;
window.escapeAttr = escapeAttr;
window.sanitizeUrl = sanitizeUrl;
