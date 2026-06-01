/**
 * HTML 转义工具 — 防止 XSS 攻击
 * 将用户输入中的特殊字符替换为 HTML 实体，安全插入 DOM
 */
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// 挂载到全局，供所有模块使用
window.escapeHtml = escapeHtml;
