/**
 * 密钥脱敏 —— 真源已移到 `utils/key-redact.ts`（2026-11-05）。
 *
 * 移动原因：规则的消费方横跨服务端**与前端**（`TokenKeyCard` 展示 API 地址时需要最后一层
 * 脱敏），放 `server/utils/` 前端引不到，于是前端原先自己抄了一份 —— 而且抄的是带
 * 「≤18 字符原样显示」宽松分支的旧版。真源移到 `utils/` 后两侧共用同一实现。
 *
 * 本文件保留为**转发层**，是为了不动既有服务端引用（`token-keys/index.get.ts`、
 * `ai-service.ts` 等）。新代码请直接用 `utils/key-redact.ts`。
 *
 * 注意这里用「先 import 再 export」而非纯重导出 `export { … } from '…'`：
 * 纯重导出不建立本地绑定，本文件若日后要加逻辑会踩坑（本项目已在
 * `DEAL_CATEGORIES` 上踩过一次）。
 */
import {
  redactKeyLike, containsKeyLike,
  KEY_PREFIXES, KEY_PREFIX_SPECIFIC, KEY_PREFIX_ALTERNATION,
} from '../../utils/key-redact'

export {
  redactKeyLike, containsKeyLike,
  KEY_PREFIXES, KEY_PREFIX_SPECIFIC, KEY_PREFIX_ALTERNATION,
}