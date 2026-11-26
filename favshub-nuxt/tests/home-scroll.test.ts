import { describe, expect, it, vi } from 'vitest'
import {
  parseHomeScrollPosition,
  restoreHomeScrollWhenActive,
  runHomeMountSequence,
} from '../pages/index.vue'

describe('首页滚动位置解析', () => {
  it('新视图没有记录时返回双滚动容器零点', () => {
    expect(parseHomeScrollPosition(null)).toEqual({ main: 0, window: 0 })
  })

  it('损坏 JSON 或错误结构不会继承上一视图偏移', () => {
    expect(parseHomeScrollPosition('{broken')).toEqual({ main: 0, window: 0 })
    expect(parseHomeScrollPosition('null')).toEqual({ main: 0, window: 0 })
    expect(parseHomeScrollPosition('[]')).toEqual({ main: 0, window: 0 })
    expect(parseHomeScrollPosition('{"main":"120","window":240}')).toEqual({ main: 0, window: 0 })
  })

  it('有效记录分别恢复 main 与 window，并清洗越界数值', () => {
    expect(parseHomeScrollPosition('{"main":120,"window":240}')).toEqual({ main: 120, window: 240 })
    expect(parseHomeScrollPosition('{"main":-10,"window":-20}')).toEqual({ main: 0, window: 0 })
    expect(parseHomeScrollPosition('{"main":null}')).toEqual({ main: 0, window: 0 })
  })
})

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function restoreDriver(active: () => boolean, frames: Array<() => void>) {
  const applyPosition = vi.fn()
  const setRestoring = vi.fn()
  const options = {
    isActive: active,
    nextTick: () => Promise.resolve(),
    requestFrame: (callback: () => void) => { frames.push(callback) },
    hasHash: () => false,
    restoreHash: vi.fn(),
    readPosition: () => ({ main: 120, window: 240 }),
    applyPosition,
    setRestoring,
  }
  return { options, applyPosition, setRestoring }
}

describe('首页滚动恢复生命周期竞态', () => {
  it('首个及后续关键 await 后离路，均不执行剩余挂载与 restore', async () => {
    let active = true
    const first = deferred()
    const second = deferred()
    const firstStep = vi.fn(() => first.promise)
    const secondStep = vi.fn(() => second.promise)
    const restore = vi.fn()
    const sequence = runHomeMountSequence(() => active, [firstStep, secondStep, restore])

    expect(firstStep).toHaveBeenCalledTimes(1)
    first.resolve()
    await vi.waitFor(() => expect(secondStep).toHaveBeenCalledTimes(1))
    active = false
    second.resolve()

    await expect(sequence).resolves.toBe(false)
    expect(restore).not.toHaveBeenCalled()
  })

  it('double-rAF 第一帧前离路，不再排第二帧或写滚动位置', async () => {
    let active = true
    const frames: Array<() => void> = []
    const { options, applyPosition } = restoreDriver(() => active, frames)
    const restoring = restoreHomeScrollWhenActive(options)
    await Promise.resolve()
    expect(frames).toHaveLength(1)

    active = false
    frames.shift()!()
    await expect(restoring).resolves.toBe(false)
    expect(frames).toHaveLength(0)
    expect(applyPosition).not.toHaveBeenCalled()
  })

  it('double-rAF 第二帧前离路，仍不写滚动位置', async () => {
    let active = true
    const frames: Array<() => void> = []
    const { options, applyPosition } = restoreDriver(() => active, frames)
    const restoring = restoreHomeScrollWhenActive(options)
    await Promise.resolve()
    frames.shift()!()
    expect(frames).toHaveLength(1)

    active = false
    frames.shift()!()
    await expect(restoring).resolves.toBe(false)
    expect(applyPosition).not.toHaveBeenCalled()
  })

  it('路由保持活跃时，两帧后恢复真实位置并解除 restoring', async () => {
    const frames: Array<() => void> = []
    const { options, applyPosition, setRestoring } = restoreDriver(() => true, frames)
    const restoring = restoreHomeScrollWhenActive(options)
    await Promise.resolve()
    frames.shift()!()
    frames.shift()!()

    await expect(restoring).resolves.toBe(true)
    expect(applyPosition).toHaveBeenCalledWith({ main: 120, window: 240 })
    expect(frames).toHaveLength(1)
    frames.shift()!()
    expect(setRestoring).toHaveBeenLastCalledWith(false)
  })
})
