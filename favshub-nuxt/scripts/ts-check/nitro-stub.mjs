/**
 * nitro 全局 stub —— 让端点模块在裸 Node 下可被 import（顶层只注册 handler，不执行）。
 * createError 保持 H3 的语义：带 statusCode 与 data.error，供测试断言。
 */
export function defineEventHandler(fn) { return fn }
export function defineRouteMeta() {}
export function defineNitroPlugin() {}

export function createError(opts = {}) {
  const err = new Error(opts?.data?.error || opts?.statusMessage || 'error')
  err.statusCode = opts?.statusCode || 500
  err.statusMessage = opts?.statusMessage
  err.data = opts?.data
  return err
}

export function getRouterParams(event) { return event?.__params || {} }
export function getQuery(event) { return event?.__query || {} }
export function getRouterParam(event, name) { return (event?.__params || {})[name] }
export async function readBody(event) { return event?.__body || {} }
export function useRuntimeConfig() { return { adminUsers: 'smokeadmin' } }
export function setHeader() {}
export function setResponseHeader() {}
export function getHeader() { return undefined }
export function getCookie() { return undefined }
export function setCookie() {}
export function deleteCookie() {}
export function getRequestURL(event) { return new URL(event?.__url || 'http://localhost/') }
export function getRequestHeader() { return undefined }
export function getRequestIP() { return '127.0.0.1' }
export function defineRouteRules() {}
export function sendStream() {}
export function sendRedirect() {}
export function readRawBody() { return Promise.resolve('') }

export default {
  defineEventHandler, defineRouteMeta, defineNitroPlugin, createError,
  getRouterParams, getQuery, getRouterParam, readBody, useRuntimeConfig,
  getCookie, setCookie, deleteCookie, getRequestURL,
}
