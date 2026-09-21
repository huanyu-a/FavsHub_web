/**
 * 服务端转发 —— 真正的实现在根 `utils/sanitize.ts`（前后端共用单一真源）。
 *
 * 保留本文件的原因：
 *   1. 服务端既有代码统一从 `../utils/sanitize` 引入，避免大范围改导入路径；
 *   2. 明确「服务端也走同一套脱敏规则」，杜绝正则漂移。
 *
 * 用相对路径（而非 `~~` alias）以便脚本可脱离 Nuxt 直接运行测试。
 * 不要在此处重复实现正则 —— 请改根 `utils/sanitize.ts`。
 */
export { redactPaths, safeErrorMessage } from '../../utils/sanitize'
