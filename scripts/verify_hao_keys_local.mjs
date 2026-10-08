#!/usr/bin/env node
/**
 * verify_hao_keys_local.mjs — local end-to-end verification for the hao-site
 * /tokens/keys feature (acceptance subset A9-A14 of
 * docs/08-hao站keys页接入设计.md). Executed by the pipeline gate as:
 *
 *   node D:/project/wwwroot/tokenhub/scripts/verify_hao_keys_local.mjs
 *
 * Exit code 0 = every check passed, 1 = at least one check failed or the
 * server could not be started. stdout carries a <=50-line summary only; all
 * details go to D:/project/wwwroot/tokenhub/scripts/verify_hao_keys_local.log
 * (rewritten on every run).
 *
 * stdlib only. Credential red line: nothing captured from the child server
 * process is written anywhere before being scrubbed through the PLAIN_KEY_RE
 * port below (same policy as tokenhub/local_server.py:758); no key value,
 * key_hash, key_encrypted value or cookie is ever logged.
 *
 * `--self-test` runs the pure helpers only (no network, no child process);
 * the gate always runs the script without flags.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

// ---- fixed absolute paths (subprocess cwd must never be assumed) ----
const SERVER_ENTRY = 'D:/project/wwwroot/FavsHub_web/favshub-nuxt/.output/server/index.mjs';
const SERVER_CWD = 'D:/project/wwwroot/FavsHub_web/favshub-nuxt';
const LOG_PATH = 'D:/project/wwwroot/tokenhub/scripts/verify_hao_keys_local.log';

const HOST = '127.0.0.1';
const PORT_CANDIDATES = [3100, 3101, 3102]; // 3100 first; 3101/3102 only on occupancy
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;
const BUSY_PROBE_TIMEOUT_MS = 2_000;
const KILL_GRACE_MS = 3_000;
const CHILD_TAIL_LINES = 40; // head of child stdout/stderr kept for the log

// ---- contract constants (docs/08-hao站keys页接入设计.md) ----
// Disclaimer, verbatim: 07 §8.5-4 (docs/07:400) == A13 (docs/08:537).
const DISCLAIMER_TEXT = '内容来自第三方论坛公开帖，仅供测试，如有侵权请联系删除';
// Sidebar SSR nav link to the keys page (08 §2; A17 asserts the same href form).
const NAV_HREF_NEEDLE = 'href="/tokens/keys"';
// Status-filter labels from 08 §3.2 ③ (docs/08:250); any one match is enough.
const STATUS_FILTER_MARKERS = ['全部状态', '有效(valid)', '失效(dead)'];
// Red-line columns that must never surface in any read-path artifact (A10).
const FORBIDDEN_SUBSTRINGS = ['key_encrypted', 'key_hash', 'error_message_raw'];
// Dead-filter probe params: the ask names `status`, the design contract names
// `verdict` (docs/08:369, A12 docs/08:536). The ask's spelling is tried first;
// the check passes only if one of them returns dead-only rows, and the log
// records which one actually took effect.
const DEAD_FILTER_PARAMS = ['status', 'verdict'];

// ---- plain-key scrub regex: verbatim JS port of local_server.py:47-52 ----
// (07 §8.2 layered vendor prefixes plus the generic `sk-` catch-all). Masked
// keys contain '*', which stops the {10,220} tail, so key_masked passes the
// scrub untouched (local_server.py:44-46). The lookbehind is supported on any
// Node >= 16.
const PLAIN_KEY_SOURCE =
  '(?<![A-Za-z0-9_\\-])(?:' +
  'sk-(?:or-v1|ant(?:-api\\d{2})?|proj|svcacct|admin|live|test)-?' +
  '|sk-|gsk_|xai-|fw_|hf_|pplx-|r8_|csk-|AIza|nvapi-|ghp_' +
  ')[A-Za-z0-9_\\-]{10,220}';

const SCRUB_REPLACEMENT = '[已脱敏]';

// ---- pure helpers (also exercised by --self-test) ----

function plainKeyRegex() {
  return new RegExp(PLAIN_KEY_SOURCE, 'g');
}

function countPlainKeyHits(text) {
  const hits = String(text).match(plainKeyRegex());
  return hits ? hits.length : 0;
}

function scrubText(text) {
  return String(text).replace(plainKeyRegex(), SCRUB_REPLACEMENT);
}

function findForbiddenSubstrings(text) {
  return FORBIDDEN_SUBSTRINGS.filter((needle) => String(text).includes(needle));
}

/**
 * Row shape (A8): key_masked must be a string that is '' (C-class guide) or
 * contains '*' (masked B-class). Anything else breaks the shape.
 */
function rowMaskOk(row) {
  const masked = row && typeof row === 'object' ? row.key_masked : undefined;
  if (typeof masked !== 'string') return false;
  return masked === '' || masked.includes('*');
}

/**
 * Dead-filter semantics (A12): every row must carry verdict === 'dead'; an
 * empty list passes vacuously (structure invariant, not a count assertion).
 */
function deadFilterResult(rows) {
  if (!Array.isArray(rows)) return { ok: false, total: 0, nonDead: 0, reason: 'keys 不是数组' };
  const nonDead = rows.filter((row) => !row || row.verdict !== 'dead').length;
  return {
    ok: nonDead === 0,
    total: rows.length,
    nonDead,
    reason: nonDead === 0 ? '' : `${nonDead} 行 verdict != dead`,
  };
}

// ---- logging: details to file (incremental flush), summary to stdout ----

const logLines = [];

function log(line) {
  logLines.push(`[${new Date().toISOString()}] ${line}`);
  flushLog();
}

function flushLog() {
  try {
    fs.writeFileSync(LOG_PATH, `${logLines.join('\n')}\n`, 'utf8');
  } catch (err) {
    process.stderr.write(`[warn] 无法写日志 ${LOG_PATH}: ${err && err.message}\n`);
  }
}

// ---- HTTP (stdlib http, no redirect following) ----

function httpGet(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= 5 * 1024 * 1024) chunks.push(chunk);
      });
      res.on('end', () => done({ ok: true, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (err) => done({ ok: false, error: err.message }));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', (err) => done({ ok: false, error: err.message }));
  });
}

// ---- child server management ----

function spawnServer(port) {
  return spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_CWD,
    env: {
      ...process.env,
      PORT: String(port),
      NITRO_PORT: String(port), // keep a stray inherited NITRO_PORT from overriding PORT
      HOST, // bind loopback for the local probe
      NITRO_HOST: HOST,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** Captures child output, scrubbed through PLAIN_KEY_RE before storage. */
function attachCapture(child) {
  const out = [];
  const err = [];
  const sink = (bucket, label) => (chunk) => {
    const text = scrubText(chunk.toString('utf8'));
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (bucket.length < CHILD_TAIL_LINES) bucket.push(`${label} ${line}`);
      else if (bucket.length === CHILD_TAIL_LINES) bucket.push(`${label} …(后续输出省略)`);
    }
  };
  child.stdout.on('data', sink(out, '[server stdout]'));
  child.stderr.on('data', sink(err, '[server stderr]'));
  return { out, err };
}

function childAlive(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

function killChild(child) {
  if (!childAlive(child)) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  const timer = setTimeout(() => {
    if (childAlive(child)) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, KILL_GRACE_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

function waitForExit(child, timeoutMs = 5_000) {
  if (!childAlive(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Anything answering HTTP on the port means it is occupied. */
async function portOccupied(port) {
  const res = await httpGet(`http://${HOST}:${port}/`, BUSY_PROBE_TIMEOUT_MS);
  return res.ok;
}

async function waitUntilReady(port, child, captured, getAbortError) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const abort = getAbortError();
    if (abort) return { ok: false, busy: false, timeout: false };
    if (!childAlive(child)) {
      const joined = captured.err.join('\n');
      if (/EADDRINUSE/.test(joined)) return { ok: false, busy: true, timeout: false };
      return { ok: false, busy: false, timeout: false };
    }
    // any HTTP status (even 404/500) proves the server is up and answering
    const res = await httpGet(`http://${HOST}:${port}/`, BUSY_PROBE_TIMEOUT_MS);
    if (res.ok) return { ok: true };
    await sleep(POLL_INTERVAL_MS);
  }
  return { ok: false, busy: false, timeout: true };
}

/**
 * Start the built Nitro server: 3100 first, then 3101/3102 only when the port
 * is occupied (per ask). A child that dies for a non-occupancy reason aborts
 * the whole start sequence — switching ports would not help.
 */
async function startServer() {
  for (const port of PORT_CANDIDATES) {
    // eslint-disable-next-line no-await-in-loop -- sequential port fallback
    if (await portOccupied(port)) {
      log(`端口 ${port} 已被占用，跳过`);
      continue;
    }
    log(`在端口 ${port} 启动 server: node ${SERVER_ENTRY} (cwd=${SERVER_CWD}, env PORT=${port})`);
    const child = spawnServer(port);
    const captured = attachCapture(child);
    let spawnError = null;
    child.on('error', (err) => {
      spawnError = err;
      log(`子进程 error 事件: ${err.message}`);
    });
    const ready = await waitUntilReady(port, child, captured, () => spawnError);
    if (ready.ok) {
      log(`server 就绪：http://${HOST}:${port}/`);
      return { child, port, captured };
    }
    const why = ready.busy
      ? '端口被占用 (EADDRINUSE)'
      : ready.timeout
        ? `就绪超时 (${READY_TIMEOUT_MS}ms)`
        : spawnError
          ? `进程启动失败: ${spawnError.message}`
          : '进程提前退出';
    log(`端口 ${port} 启动失败：${why}`);
    for (const line of [...captured.out, ...captured.err].slice(-10)) log(`  ${line}`);
    killChild(child);
    // eslint-disable-next-line no-await-in-loop
    await waitForExit(child, KILL_GRACE_MS * 2);
    if (!ready.busy && !ready.timeout) return null;
  }
  return null;
}

// ---- checks ----

function makeCheck(name, pass, details, summarySuffix = '') {
  return { name, pass, details, summarySuffix };
}

async function runChecks(port) {
  const base = `http://${HOST}:${port}`;
  const checks = [];

  // -- page: GET /tokens/keys (ask #2; A13/A14) --
  const page = await httpGet(`${base}/tokens/keys`);
  const pageOk = page.ok && page.status === 200;
  checks.push(makeCheck('GET /tokens/keys → 200', pageOk, [
    `HTTP: ${page.ok ? page.status : `请求失败 (${page.error})`}`,
    pageOk ? `HTML 长度: ${page.body.length} 字符` : '',
  ].filter(Boolean)));

  if (pageOk) {
    const html = page.body;
    const hasDisclaimer = html.includes(DISCLAIMER_TEXT);
    checks.push(makeCheck('页面含免责声明原文（07 §8.5-4 / A13）', hasDisclaimer, [
      hasDisclaimer ? '免责关键句命中' : `未命中关键句「${DISCLAIMER_TEXT}」`,
    ]));
    const hasNav = html.includes(NAV_HREF_NEEDLE);
    checks.push(makeCheck('页面含指向 /tokens/keys 的导航链接', hasNav, [
      `查找 ${NAV_HREF_NEEDLE}: ${hasNav ? '命中' : '未命中'}`,
    ]));
    const filterMarker = STATUS_FILTER_MARKERS.find((marker) => html.includes(marker)) || null;
    checks.push(makeCheck('页面含状态筛选控件（08 §3.2 ③）', filterMarker !== null, [
      `候选标识: ${STATUS_FILTER_MARKERS.join(' / ')}`,
      `命中: ${filterMarker ?? '无'}`,
    ], filterMarker ? `（命中：${filterMarker}）` : ''));
    const keyHits = countPlainKeyHits(html);
    checks.push(makeCheck('HTML 全文明文 key 扫描 0 命中（PLAIN_KEY_RE, local_server.py:47-52）', keyHits === 0, [
      `命中数: ${keyHits}`,
    ]));
    const leaked = findForbiddenSubstrings(html);
    checks.push(makeCheck('HTML 不含 key_encrypted / key_hash / error_message_raw 字样', leaked.length === 0, [
      leaked.length === 0 ? '零命中' : `命中: ${leaked.join(', ')}`,
    ]));
  } else {
    checks.push(makeCheck('页面内容断言组（页面请求失败，整组记 FAIL）', false, [
      '页面未返回 200，免责声明/导航/筛选/明文扫描断言无法执行',
    ]));
  }

  // -- API: GET /api/token-keys (ask #3; A9/A10) --
  const api = await httpGet(`${base}/api/token-keys`);
  const apiOk = api.ok && api.status === 200;
  checks.push(makeCheck('GET /api/token-keys → 200', apiOk, [
    `HTTP: ${api.ok ? api.status : `请求失败 (${api.error})`}`,
  ]));

  if (apiOk) {
    const leaked = findForbiddenSubstrings(api.body);
    checks.push(makeCheck('API 原始响应不含 key_encrypted / key_hash / error_message_raw（A10 全文子串口径）', leaked.length === 0, [
      leaked.length === 0 ? '零命中' : `命中: ${leaked.join(', ')}`,
    ]));

    let parsed = null;
    let parseError = '';
    try {
      parsed = JSON.parse(api.body);
    } catch (err) {
      parseError = err.message;
    }
    checks.push(makeCheck('API 响应为合法 JSON', parsed !== null, [
      parseError ? `JSON.parse 失败: ${parseError}` : 'JSON.parse 成功',
    ]));

    if (parsed && typeof parsed === 'object') {
      const rows = Array.isArray(parsed.keys) ? parsed.keys : null;
      const pagination = parsed.pagination && typeof parsed.pagination === 'object' ? parsed.pagination : null;
      const paginationOk = rows !== null && pagination !== null && Number.isFinite(Number(pagination.total));
      checks.push(makeCheck('分页列表存在（keys 数组 + pagination.total）', paginationOk, [
        `keys: ${rows === null ? '缺失或非数组' : `数组，${rows.length} 行`}`,
        `pagination.total: ${pagination && pagination.total !== undefined ? Number(pagination.total) : '缺失'}`,
        pagination ? `pagination 其余键: ${Object.keys(pagination).join(', ')}` : 'pagination: 缺失',
        parsed.verdict_counts ? 'verdict_counts: 存在（A9）' : 'verdict_counts: 缺失（A9 期望存在，仅记录不判失败）',
      ], rows !== null ? `（${rows.length} 行）` : ''));

      if (rows !== null) {
        const badIdx = [];
        rows.forEach((row, idx) => {
          if (!rowMaskOk(row)) badIdx.push(idx);
        });
        checks.push(makeCheck('每行 key_masked 含 * 或为空（C 类指引行；A8 形状）', badIdx.length === 0, [
          `检查行数: ${rows.length}`,
          badIdx.length === 0 ? '全部合规（只判形状，不记录值）' : `违规行下标: ${badIdx.slice(0, 10).join(', ')}${badIdx.length > 10 ? ' …' : ''}`,
          rows.length === 0 ? '警告: 列表为空，逐行断言按空集满足（vacuous），请结合 pagination.total 人工复核' : '',
        ].filter(Boolean)));
      } else {
        checks.push(makeCheck('每行 key_masked 含 * 或为空（C 类指引行；A8 形状）', false, [
          '响应无 keys 数组，无法逐行检查',
        ]));
      }
    } else {
      checks.push(makeCheck('分页列表存在（keys 数组 + pagination.total）', false, ['JSON 解析失败，结构断言无法执行']));
      checks.push(makeCheck('每行 key_masked 含 * 或为空（C 类指引行；A8 形状）', false, ['JSON 解析失败，逐行断言无法执行']));
    }
  } else {
    checks.push(makeCheck('API 内容断言组（API 请求失败，整组记 FAIL）', false, [
      'API 未返回 200，A9/A10 相关断言无法执行',
    ]));
  }

  // -- dead filter (ask #4) --
  const deadDetails = [];
  let deadOk = null; // { param, total }
  for (const param of DEAD_FILTER_PARAMS) {
    // eslint-disable-next-line no-await-in-loop -- sequential param fallback
    const res = await httpGet(`${base}/api/token-keys?${param}=dead`);
    if (!(res.ok && res.status === 200)) {
      deadDetails.push(`?${param}=dead → ${res.ok ? res.status : `请求失败 (${res.error})`}`);
      continue;
    }
    let probeRows = null;
    try {
      const parsed = JSON.parse(res.body);
      probeRows = Array.isArray(parsed.keys) ? parsed.keys : null;
    } catch {
      probeRows = null;
    }
    if (probeRows === null) {
      deadDetails.push(`?${param}=dead → 200 但响应无 keys 数组`);
      continue;
    }
    const verdictRes = deadFilterResult(probeRows);
    deadDetails.push(`?${param}=dead → 200，${verdictRes.total} 行，${verdictRes.ok ? '全部 verdict=dead' : `不满足: ${verdictRes.reason}`}`);
    if (verdictRes.ok) {
      deadOk = { param, total: verdictRes.total };
      break;
    }
  }
  if (deadOk && deadOk.param !== DEAD_FILTER_PARAMS[0]) {
    deadDetails.push(`偏离说明: 任务口径为 status 参数，设计文档契约 (docs/08:369、A12 docs/08:536) 为 verdict 参数；实测生效的是 ?${deadOk.param}=dead`);
  }
  checks.push(makeCheck(
    `dead 筛选只含 dead 行（${deadOk ? `?${deadOk.param}=dead · ${deadOk.total} 行` : 'status/verdict 均未生效'}）`,
    deadOk !== null,
    deadDetails.length ? deadDetails : ['未获得任何过滤请求结果'],
  ));

  return checks;
}

// ---- summary (stdout, <=50 lines) ----

function printSummary(checks, headerLines) {
  const lines = [...headerLines];
  for (const check of checks) {
    lines.push(`[${check.pass ? 'PASS' : 'FAIL'}] ${check.name}${check.summarySuffix || ''}`);
  }
  const passed = checks.filter((check) => check.pass).length;
  lines.push(passed === checks.length
    ? `[PASS] ${passed}/${checks.length} 项全部通过`
    : `[FAIL] ${passed}/${checks.length} 项通过，其余见日志`);
  lines.push(`详细日志: ${LOG_PATH}`);
  for (const line of lines) console.log(line);
}

// ---- self-test (pure helpers only, no network / no child process) ----

function runSelfTest() {
  const results = [];
  const add = (name, pass) => results.push({ name, pass });

  // fake shapes only — constructed programmatically, never real key material
  const fakePlain = `sk-${'a'.repeat(20)}`;
  const fakePlainGsk = `gsk_${'b'.repeat(20)}`;
  const fakeMasked = `sk-NoN${'*'.repeat(8)}wxyz`;
  const wordPrefixed = `task-${'c'.repeat(20)}`;

  add('plain sk- 命中 1 次', countPlainKeyHits(fakePlain) === 1);
  add('gsk_ 前缀命中 1 次', countPlainKeyHits(fakePlainGsk) === 1);
  add('星号脱敏形态 0 命中（key_masked 可原样通过）', countPlainKeyHits(fakeMasked) === 0);
  add('词内 sk- 被负向断言挡住（task-…）', countPlainKeyHits(wordPrefixed) === 0);
  add('空文本 0 命中', countPlainKeyHits('') === 0);
  add('scrub 后不再命中', countPlainKeyHits(scrubText(fakePlain)) === 0 && scrubText(fakePlain) === SCRUB_REPLACEMENT);
  add('嵌套 key_hash 被全文子串检查发现', findForbiddenSubstrings('{"a":{"key_hash":"x"}}').join(',') === 'key_hash');
  add('干净 JSON 零命中', findForbiddenSubstrings('{"ok":1}').length === 0);
  add('rowMaskOk: 空串（C 类）通过', rowMaskOk({ key_masked: '' }) === true);
  add('rowMaskOk: 星号脱敏通过', rowMaskOk({ key_masked: fakeMasked }) === true);
  add('rowMaskOk: 无星号明文形状不通过', rowMaskOk({ key_masked: 'z'.repeat(24) }) === false);
  add('rowMaskOk: 缺字段/空值不通过', rowMaskOk({}) === false && rowMaskOk(null) === false);
  add('deadFilterResult: 全 dead 通过', (() => { const r = deadFilterResult([{ verdict: 'dead' }, { verdict: 'dead' }]); return r.ok && r.total === 2 && r.nonDead === 0; })());
  add('deadFilterResult: 混入非 dead 不通过', (() => { const r = deadFilterResult([{ verdict: 'dead' }, { verdict: 'valid' }]); return !r.ok && r.nonDead === 1; })());
  add('deadFilterResult: 空列表按空集满足（A12）', deadFilterResult([]).ok === true);
  add('deadFilterResult: 非数组不通过', deadFilterResult(null).ok === false);

  for (const result of results) console.log(`[${result.pass ? 'PASS' : 'FAIL'}] ${result.name}`);
  const passed = results.filter((result) => result.pass).length;
  console.log(passed === results.length
    ? `[PASS] self-test ${passed}/${results.length} 全部通过`
    : `[FAIL] self-test ${passed}/${results.length} 通过`);
  return passed === results.length;
}

// ---- entry ----

let activeChild = null; // for the crash safety net

function killActiveChild() {
  if (activeChild) killChild(activeChild);
}

async function main() {
  log('=== verify_hao_keys_local 开始 ===');
  log(`node ${process.version} · ${process.platform} · script: ${process.argv[1] || '(unknown)'}`);

  if (!fs.existsSync(SERVER_ENTRY)) {
    log(`server 入口不存在: ${SERVER_ENTRY}（需要先完成 Nitro 构建产物 .output）`);
    console.log('[FAIL] server 入口不存在，无法验证');
    console.log(`  期望: ${SERVER_ENTRY}`);
    console.log(`详细日志: ${LOG_PATH}`);
    flushLog();
    process.exit(1);
  }

  const started = await startServer();
  if (!started) {
    log('server 在所有候选端口 (3100/3101/3102) 上均未能启动');
    console.log('[FAIL] server 未能启动（3100/3101/3102，详见日志）');
    console.log(`详细日志: ${LOG_PATH}`);
    flushLog();
    process.exit(1);
  }
  activeChild = started.child;

  let exitCode = 1;
  try {
    const checks = await runChecks(started.port);
    for (const check of checks) {
      log(`check ${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
      for (const detail of check.details) log(`  - ${detail}`);
    }
    const allPass = checks.every((check) => check.pass);
    exitCode = allPass ? 0 : 1;
    log(`结果: ${checks.filter((check) => check.pass).length}/${checks.length} 项通过，exit=${exitCode}`);
    printSummary(checks, [`[hao keys 本地验证] Node ${process.version} · server 端口 ${started.port}`]);
  } finally {
    log('停止 server 子进程（try/finally 保证，失败路径同样执行）');
    killChild(started.child);
    await waitForExit(started.child, KILL_GRACE_MS * 2);
    for (const line of [...started.captured.out, ...started.captured.err].slice(-15)) {
      log(`子进程输出尾部 ${line}`);
    }
    log('=== verify_hao_keys_local 结束 ===');
    flushLog();
  }
  process.exit(exitCode);
}

if (process.argv.includes('--self-test')) {
  process.exit(runSelfTest() ? 0 : 1);
}

process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${(err && err.stack) || err}`);
  killActiveChild();
  flushLog();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log(`unhandledRejection: ${(reason && (reason.stack || reason.message)) || reason}`);
  killActiveChild();
  flushLog();
  process.exit(1);
});

main().catch((err) => {
  process.stderr.write(`脚本异常退出: ${(err && err.stack) || err}\n`);
  log(`main 异常: ${(err && err.stack) || err}`);
  killActiveChild();
  flushLog();
  process.exit(1);
});
