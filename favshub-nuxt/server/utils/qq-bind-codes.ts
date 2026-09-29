/**
 * QQ 绑定码服务（进程内存即可，码本就 10 分钟有效）
 *
 * 流程：网站侧（/api/qq/bind-code）生成 6 位数字码 → 用户在 QQ 私聊机器人
 * 发送「绑定 <码>」→ 机器人校验码后写入 qq_bindings。绑定动作只发生在机器人
 * 私聊指令中，网站侧只生成码，避免任何「知道用户名即可抢绑」的口子。
 *
 * 同用户未过期时复用同一个码（重复点击生成不刷码）。
 */

const BIND_CODE_TTL_MS = 10 * 60 * 1000

const bindCodes = new Map<string, { userId: number; expiresAt: number }>()

/** 清理过期码（生成新码时顺带执行，防止 Map 无限增长） */
function pruneExpired() {
  const now = Date.now()
  for (const [code, info] of bindCodes) {
    if (info.expiresAt <= now) bindCodes.delete(code)
  }
}

/**
 * 为用户生成 6 位数字绑定码；该用户仍有未过期码时复用同一个
 */
export function createBindCode(userId: number): { code: string; expiresAt: number } {
  const now = Date.now()
  // 复用未过期码
  for (const [code, info] of bindCodes) {
    if (info.userId === userId && info.expiresAt > now) {
      return { code, expiresAt: info.expiresAt }
    }
  }
  pruneExpired()
  let code = ''
  do {
    code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
  } while (bindCodes.has(code))
  const expiresAt = now + BIND_CODE_TTL_MS
  bindCodes.set(code, { userId, expiresAt })
  return { code, expiresAt }
}

/**
 * 校验并消费绑定码（机器人「绑定 <code>」指令用）。
 * 绑定码本身就是凭据（只有网站账号持有者看得到码），码内携带 userId 随校验返回。
 * 码无效 / 已过期 → 明确报错。
 */
export function consumeBindCode(code: string): { ok: true; userId: number } | { ok: false; error: string } {
  const normalized = String(code ?? '').trim()
  const info = bindCodes.get(normalized)
  if (!info) {
    return { ok: false, error: '绑定码无效，请在网站个人面板重新生成' }
  }
  if (info.expiresAt <= Date.now()) {
    bindCodes.delete(normalized)
    return { ok: false, error: '绑定码已过期，请在网站个人面板重新生成' }
  }
  bindCodes.delete(normalized)
  return { ok: true, userId: info.userId }
}
