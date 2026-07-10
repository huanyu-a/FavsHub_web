/**
 * 百度统计客户端插件（四层防爬，针对源码泄露场景设计）
 *
 * 防护分层：
 *   1. ID 走数据库 system_config，源码零字面量（防 GitHub 泄露 / grep 扫描）
 *   2. 运行时动态拼接脚本 URL，SSR HTML / view-source 不出现 "hm.js?<FULL_ID>"
 *   3. 域名白名单校验，仅配置的域名触发，复制到别的域名不统计
 *   4. requestIdleCallback 延迟注入，不等空闲回调的无头爬虫拿不到
 *
 * 客户端限制：ID 必须到达浏览器才能工作，构建产物和 DevTools 网络面板无法隐藏。
 *   目标是挡住 95% 的复制和自动爬取，叠加百度统计后台的域名白名单做双重兜底。
 */

const MAX_IDLE_WAIT_MS = 3000;

interface TdkData {
  siteTitle?: string;
  siteDescription?: string;
  siteKeywords?: string;
  baiduTongjiId?: string;
  baiduTongjiDomains?: string;
}

export default defineNuxtPlugin(() => {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // 客户端发起请求获取 TDK（Nitro 服务端 5 min 缓存，不会造成压力）
  // 注意：这里不在 SSR 阶段运行（.client.ts），SSR HTML 永远不包含统计脚本
  $fetch<TdkData>("/api/tdk")
    .then((tdk) => maybeInject(tdk))
    .catch(() => { /* 静默失败，不影响页面 */ });
});

function maybeInject(tdk: TdkData): void {
  const id = tdk.baiduTongjiId;
  const domainsRaw = tdk.baiduTongjiDomains;
  if (!id) return;

  // --- 第 3 层：域名白名单 ---
  // domainsRaw 为空表示不限制（调试方便 / 多域名场景）；非空则仅匹配列表
  const allowedHosts = (domainsRaw || "")
    .split(",")
    .map((s) => s.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean);
  if (allowedHosts.length > 0 && !allowedHosts.includes(window.location.hostname)) return;

  // --- 第 4 层：空闲期延迟注入 ---
  const inject = () => injectBaiduTongji(id);
  if ("requestIdleCallback" in window) {
    requestIdleCallback(inject, { timeout: MAX_IDLE_WAIT_MS });
  } else {
    window.addEventListener("load", () => setTimeout(inject, 1000));
  }
}

/**
 * 注入百度统计脚本
 * URL 在运行时由 ID 动态拼接，源码中不出现完整 URL 字面量
 */
function injectBaiduTongji(id: string): void {
  // 防重复注入
  if ((window as any)._hmt && (window as any)._hmt._p) return;

  // 初始化全局队列（百度统计要求）
  const _hmt = ((window as any)._hmt = (window as any)._hmt || []);

  // --- 第 2 层：动态拼接脚本 URL ---
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://hm.baidu.com/hm.js?" + id;

  const firstScript = document.getElementsByTagName("script")[0];
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  // 标记已注入
  _hmt._p = true;
}

// 扩展 Window 类型
declare global {
  interface Window {
    _hmt?: Array<[string, ...unknown[]]> & { _p?: boolean };
  }
}
