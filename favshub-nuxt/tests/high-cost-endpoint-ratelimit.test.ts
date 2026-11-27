import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 与 tests/api-rate-limits.test.ts 一致：Vitest 以项目根为 cwd；
// happy-dom 下 import.meta.url 不是 file: scheme，不能用来推根目录。
const ROOT = process.cwd()
const SCRIPT = join(ROOT, 'scripts', 'high-cost-endpoint-ratelimit.mjs')

/** 自身 watchdog：必须小于 it 的 timeout，超时由我们自己杀进程，不靠 Vitest 超时硬切 */
const WATCHDOG_MS = 240_000

/**
 * 只杀自己 spawn 的那棵树：脚本 PID 及其拉起的 Nitro 子进程。
 * Windows 上 TerminateProcess 不会执行脚本里的 JS 清理，所以用 taskkill /T 杀整棵（自己 spawn 的）树；
 * POSIX 下脚本带 detached 进程组，先给脚本发 SIGTERM 让它自己清 Nitro，再兜底杀进程组。
 */
async function killOwnTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      tk.on('error', () => resolve())
      tk.on('close', () => resolve())
    })
    return
  }
  try { child.kill('SIGTERM') } catch { /* 已退出 */ }
  await new Promise(resolve => setTimeout(resolve, 3000))
  try { process.kill(-child.pid, 'SIGKILL') } catch { /* 进程组已不存在 */ }
  try { child.kill('SIGKILL') } catch { /* 已退出 */ }
}

/**
 * 真实 Nitro 服务 + 临时 SQLite 的端到端限频验证，实现全部在
 * `scripts/high-cost-endpoint-ratelimit.mjs`（可独立 node 直跑，Windows 可用）。
 * 这里只做一层 Vitest 包装：起子进程跑脚本、透传退出码与关键状态序列，
 * 并自带 watchdog/finally —— 超时或异常时杀掉自己 spawn 的脚本树，不依赖 Vitest 超时。
 * 与 tests/api-rate-limits.test.ts 的源码级断言互补：那条管「代码里有没有写」，
 * 这条管「真服务跑起来第 31/21 次是不是真 429、Retry-After、校验顺序与分桶有没有被误改」。
 */
describe('高成本端点限频（真实 Nitro + 临时 SQLite）', () => {
  it.skipIf(!existsSync(join(ROOT, '.output', 'server', 'index.mjs')))(
    'search 同 IP 第 31 次 429、upload-preview 同用户第 21 次 429，28 项断言 0 失败 0 WARN',
    { timeout: 300_000 },
    async () => {
      let child: ChildProcess | null = null
      let watchdog: ReturnType<typeof setTimeout> | null = null
      try {
        const result = await new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve, reject) => {
          const proc = spawn(process.execPath, [SCRIPT], {
            cwd: ROOT,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            detached: process.platform !== 'win32',
          })
          child = proc
          let output = ''
          proc.stdout.on('data', d => { output += String(d) })
          proc.stderr.on('data', d => { output += String(d) })
          proc.on('error', reject)
          proc.on('close', code => {
            if (watchdog) clearTimeout(watchdog)
            resolve({ code, output, timedOut: false })
          })
          watchdog = setTimeout(() => {
            output += `\n[watchdog] ${WATCHDOG_MS}ms 未结束，主动杀掉脚本进程树\n`
            void killOwnTree(proc).finally(() => resolve({ code: null, output, timedOut: true }))
          }, WATCHDOG_MS)
        })

        // 失败/超时时把完整输出带进断言信息，便于定位是哪一条硬断言红了
        expect(result.timedOut, `watchdog 超时，输出：\n${result.output}`).toBe(false)
        expect(result.code, `脚本退出码非 0，输出：\n${result.output}`).toBe(0)
        expect(result.output).toContain('search 31 次状态序列：200×30,429×1')
        expect(result.output).toContain('upload-preview 21 次状态序列：200×20,429×1')
        expect(result.output).toContain('通过 28 项硬断言，失败 0 项，WARN 0 项')
        expect(result.output).toContain('临时目录已删除=true')
      } finally {
        if (watchdog) clearTimeout(watchdog)
        // 异常（含 spawn error、断言失败前的意外）也要收掉自己 spawn 的脚本树
        if (child) await killOwnTree(child)
      }
    },
  )
})
