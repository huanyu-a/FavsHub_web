export default defineContentScript({
  // 静态匹配占位（不注入任何页面），实际由 background.ts 动态注册到 FavsHub 网站
  matches: ['https://example.invalid/*'],
  run_at: 'document_start',
  main() {
    // 在 DOM 上标记扩展模式，让页面的 chrome-shim.js 能检测到
    document.documentElement.setAttribute('data-favshub-ext', 'active');

    // 中继网站页面与 background 之间的消息
    window.addEventListener('message', async (event) => {
      // 只处理来自同源页面的 FavsHub 请求
      if (event.source !== window) return;
      if (!event.data || event.data.type !== 'favshub-ext-request') return;

      const { action, requestId, ...params } = event.data;

      try {
        // 转发给 background script（携带页面传递的参数）
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
