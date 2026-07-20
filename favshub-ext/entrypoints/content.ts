/**
 * 安全白名单：仅允许网站页面通过中继调用以下 action。
 * 
 * 安全模型：
 * - 此 content script 仅注入到用户配置的 FavsHub 网站（由 background.ts 动态注册）
 * - 严格校验 event.origin === window.location.origin，防止跨域注入
 * - 白名单限制可调用的 action，阻止 proxyFetch / getIconUrl 等敏感操作通过网站触发
 *   （这些操作由 floating-ball content script 直接调用，不需要通过网站中继）
 */
const RELAY_ALLOWED_ACTIONS = new Set([
  'ping',
  'open_side_panel',
  'navigateHome',
  'openUrlInSidePanel',
  'openTab',
  'updateFloatingBall',
  // 以下 action 供网站功能使用，安全性由 relay 的 origin 校验 + 白名单保证
  'searchHistory',     // SearchBar.vue 搜索建议（浏览历史）
  'openHistory',       // FloatingNav.vue 历史记录按钮
  'openDownloads',     // FloatingNav.vue 下载记录按钮
  'openPasswords',     // FloatingNav.vue 密码管理按钮
  'openExtensions',    // FloatingNav.vue 扩展管理按钮
]);

export default defineContentScript({
  // 静态匹配占位（不注入任何页面），实际由 background.ts 动态注册到 FavsHub 网站
  matches: ['https://example.invalid/*'],
  runAt: 'document_start',
  main() {
    // 在 DOM 上标记扩展模式，让页面的 chrome-shim.js 能检测到
    document.documentElement.setAttribute('data-favshub-ext', 'active');

    // 中继网站页面与 background 之间的消息
    window.addEventListener('message', async (event) => {
      // 只处理来自同源页面的 FavsHub 请求
      if (event.source !== window) return;
      // 严格校验 origin，防止跨域消息注入
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'favshub-ext-request') return;

      const { action, requestId, ...params } = event.data;

      // 白名单过滤：拒绝不在允许列表中的 action
      if (!action || !RELAY_ALLOWED_ACTIONS.has(action)) {
        window.postMessage({
          type: 'favshub-ext-response',
          requestId,
          payload: { success: false, error: 'Action not allowed' },
        }, window.origin);
        return;
      }

      try {
        // 转发给 background script（仅携带白名单 action）
        const response = await browser.runtime.sendMessage({ action, ...params });

        // 回传结果给网站页面
        window.postMessage({
          type: 'favshub-ext-response',
          requestId,
          payload: response || { success: true }
        }, window.origin);
      } catch (err) {
        window.postMessage({
          type: 'favshub-ext-response',
          requestId,
          payload: { success: false, error: String(err) }
        }, window.origin);
      }
    });
  },
});
