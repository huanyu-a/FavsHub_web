/**
 * scripts/lib/free-port.mjs — 门禁套件共用的「运行时挑空闲端口 + 端口冲突换端口重试」
 *
 * ## 为什么会有这个文件
 *
 * 门禁里的套件原先各自把监听端口**硬编码**（3255 / 3258 / 3262 / 3267 / 3270 / 3210 …）。
 * 只要本机有一个残留实例（上次跑挂了的套件、手工调试起的服务）占着那个号，
 * 新起的应用就会 `EADDRINUSE` 直接死；而症状是「某个套件起不来」，
 * `assertion-count.mjs` 却把它报成「文档里的断言数不符」—— 照着提示去改文档，
 * 恰好会把真实覆盖一起丢掉（真踩过，见 assertion-count.mjs 同日的注释）。
 *
 * 2026-11-09 先把 `state-machine.mjs` / `admin-invalid-filters.mjs` 改成运行时挑端口，
 * 但那只是「绑 `:0` 拿号 → 立刻释放 → 交给应用 listen」：**释放到应用真正 listen
 * 之间有一个竞争窗口**，端口可能被别的进程抢走，于是照样 EADDRINUSE。
 * 本文件把这段逻辑集中下来，并补上「冲突就换端口重试」。
 *
 * ## 设计要点
 *
 *   - `pickFreePort()`：绑 `:0` 让内核分配一个空闲端口，拿到号后**立即释放**
 *     （不占着它 —— 占着就没法给真正的应用用了）。
 *   - `isPortConflictError(...evidence)`：**明确的判据函数**，只认「端口被占」的
 *     具体文字证据（EADDRINUSE / address already in use / 本仓库 waitPortFree 的中文诊断）。
 *     刻意不做 `message.includes('error')` 这类宽泛匹配 —— 那会把 ABI 不匹配、
 *     迁移失败、语法错误也当成端口冲突，白白重试 5 次并掩盖真实病因。
 *   - `startWithFreePort(start, { attempts, onRetry })`：挑端口 → `await start(port)`；
 *     **仅当失败且判据成立**时才换端口重试，其它错误立刻抛出（不空转 attempts 次超时）。
 *
 * ## `start` 的两种失败形态（门禁两边都用到）
 *
 *   1. **抛异常**，且 `error.message` 里通常带着子进程日志
 *      （`state-machine` / `third-batch-server` / `api-public-surface` … 都是这样）。
 *   2. **返回假值**：`ai-api-gate.mjs` 的 `startApp` 返回布尔而不是抛异常。
 *      这种形状没有 message，所以约定它返回 `{ ok: false, evidence: <子进程日志> }`
 *      把证据带出来；纯 `false` 也认作失败，但没有证据 → 按「非端口冲突」处理（立刻抛）。
 */

import { createServer } from 'node:net'

/** 绑定地址：与各套件原先硬编码的 `127.0.0.1:<port>` 一致（只监听回环，不对外暴露） */
const DEFAULT_HOST = '127.0.0.1'

/**
 * 「端口冲突」的证据模式 —— 逐条列出，不猜。
 */
export const PORT_CONFLICT_PATTERNS = [
  /EADDRINUSE/,                             // libuv 的 errno 名：`Error: listen EADDRINUSE: address already in use 127.0.0.1:3262`
  /address already in use/i,                // Node 在 Linux/macOS 上的 strerror 文案
  /Only one usage of each socket address/i, // Windows 上的对应文案
  /端口\s*\d+\s*仍被占用/,                    // 本仓库 waitPortFree() 的中文诊断（state-machine / third-batch-server）
]

/**
 * 绑 `:0` 让内核挑一个空闲端口，拿到号后立刻释放。
 *
 * ⚠️ 释放与「应用真正 listen」之间仍有竞争窗口 —— 本文件存在的意义就是兜住它，
 * 不要在别处复制这段逻辑。
 */
export async function pickFreePort(host = DEFAULT_HOST) {
  return await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, host, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** 把任意「证据」形状折成一段可搜索的文本（不认识的对象返回空串，不 dump `[object Object]`） */
function toEvidenceText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(toEvidenceText).filter(Boolean).join('\n')
  if (value instanceof Error) return `${value.message}\n${value.stack || ''}`
  if (typeof value === 'object') {
    // `start` 用 `{ ok:false, evidence }` / `{ ok:false, logs }` 明确带出子进程日志
    if ('evidence' in value) return toEvidenceText(value.evidence)
    if ('logs' in value) return toEvidenceText(value.logs)
    if ('message' in value) return toEvidenceText(value.message)
  }
  return ''
}

/**
 * 判据：这些证据里有没有「端口被占」？
 * 可传字符串、Error、`{evidence}` / `{logs}` 对象，或它们的数组。
 */
export function isPortConflictError(...evidence) {
  const text = evidence.map(toEvidenceText).filter(Boolean).join('\n')
  if (!text.trim()) return false
  return PORT_CONFLICT_PATTERNS.some((re) => re.test(text))
}

/** 「起来了」的约定：没抛异常、且返回值不是 `false` / `{ ok:false }`（ai-api-gate 的 startApp 形状） */
function startedOk(result) {
  if (result === false) return false
  if (result && typeof result === 'object' && result.ok === false) return false
  return true
}

/** 把「start 返回失败值」折成一个 Error，并把证据带进 message（后续判据与报错都用得上） */
function failureFrom(port, result) {
  const evidence = toEvidenceText(result).trim()
  return new Error(
    `应用未就绪（start 在端口 ${port} 上返回失败）${evidence ? `：\n${evidence.slice(-800)}` : ''}`,
  )
}

/**
 * 挑空闲端口起应用；**只有看起来像端口冲突**才换端口重试。
 *
 * @param {(port: number) => any} start 用给定端口起应用。可抛异常，也可返回假值（见文件头）。
 * @param {object} [opts]
 * @param {number} [opts.attempts=5] 最多尝试几次（含第一次）
 * @param {(info: {attempt: number, port: number, nextPort: number, tried: number[], error: any}) => any} [opts.onRetry]
 *        判定为端口冲突、且还有下一次机会时调用（用于打日志；`nextPort` 是下一次要用的端口）。
 * @param {() => Promise<number>} [opts.pickPort=pickFreePort] 端口来源。
 *        **测试缝**：默认就是 `pickFreePort`；只有「验证换端口重试」这类测试才需要注入
 *        （见 scripts/lib/free-port.test.mjs），业务套件一律用默认值、不要传。
 * @returns {Promise<any>} 第一次成功那次的 `start` 返回值
 */
export async function startWithFreePort(start, { attempts = 5, onRetry, pickPort = pickFreePort } = {}) {
  if (typeof start !== 'function') throw new TypeError('startWithFreePort(start)：start 必须是 (port) => any')
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError(`startWithFreePort：attempts 必须是 ≥1 的整数（收到 ${attempts}）`)
  }
  if (typeof pickPort !== 'function') throw new TypeError('startWithFreePort：pickPort 必须是 () => Promise<number>')

  const tried = []
  let lastError = null
  let port = await pickPort()

  for (let attempt = 1; attempt <= attempts; attempt++) {
    tried.push(port)
    let failure = null
    try {
      const result = await start(port)
      if (startedOk(result)) return result
      failure = failureFrom(port, result)
    } catch (error) {
      failure = error
    }

    // 只有「端口被占」才值得换端口重试；其它错误立刻抛，不白等 attempts 次超时。
    if (!isPortConflictError(failure)) throw failure

    lastError = failure
    if (attempt === attempts) break
    const nextPort = await pickPort()
    if (typeof onRetry === 'function') {
      await onRetry({ attempt, port, nextPort, tried: [...tried], error: failure })
    }
    port = nextPort
  }

  throw lastError ?? new Error(`startWithFreePort：${attempts} 次尝试均失败（端口 ${tried.join('、')}）`)
}
