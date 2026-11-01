/*!
 * dsh-plugin-office-markdown — settings-page HTTP API (host half)
 *
 * The settings page lives in the client half, which cannot touch the
 * filesystem, spawn pip, or probe interpreters. This module exposes the small
 * JSON surface it needs over the host `webServer` service under the single
 * prefix `/office-markdown`:
 *
 *   GET  /office-markdown/api/status          fast — current converter + snapshot + job
 *   GET  /office-markdown/api/probe           slow — full per-interpreter inspection;
 *                                             `?force=1` bypasses the probeTtlMs cache
 *   GET  /office-markdown/api/workspace-files read-only — Office/PDF files in the workspace
 *                                             the last tool call saw (no conversion, no writes)
 *   GET  /office-markdown/api/job             progress of a running install/uninstall
 *   POST /office-markdown/api/convert-test    { path } — run the real converter chain on
 *                                             one absolute path, for the settings page's
 *                                             "试转一个文件" card (never touches the cache)
 *   POST /office-markdown/api/env/install     { target? } — pip install "markitdown[all]",
 *                                             or record an existing install so the
 *                                             uninstaller knows what to remove
 *   POST /office-markdown/api/env/uninstall   pip uninstall exactly what we installed
 *
 * Install and uninstall run as a background job: the HTTP call returns at once
 * and the page polls `/api/job`, so a multi-minute pip run cannot time out.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  analyzeMarkdown,
  classify,
  converterLabelFor,
  convertFile,
  probeConverters,
  pythonCandidates,
  readFidelityMarker,
  safeBaseName
} from './convert.js'
import {
  adoptMarkitdown,
  commandOf,
  inspectEnvironments,
  installMarkitdown,
  invalidateProbeCache,
  readSnapshot,
  snapshotSummary,
  uninstallMarkitdown
} from './env.js'
import { lastWorkspace } from './recent.js'

export const API_BASE = '/office-markdown'
const JOB_MAX_LOG = 300

/* 工作区文件下拉的上限，逐条都收紧：设置页只是给个方便，不是文件浏览器。
 * 深度 3 层 / 最多 200 个文件 / 最多扫 5000 个目录项，超出就截断并在响应里说明。 */
const SCAN_MAX_DEPTH = 3
const SCAN_MAX_FILES = 200
const SCAN_MAX_ENTRIES = 5000
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.dsh'])

let currentJob = null

function jobView() {
  if (!currentJob) return null
  return {
    id: currentJob.id,
    kind: currentJob.kind,
    state: currentJob.state,
    startedAt: currentJob.startedAt,
    finishedAt: currentJob.finishedAt,
    log: currentJob.log.slice(-JOB_MAX_LOG),
    result: currentJob.result,
    error: currentJob.error
  }
}

function startJob(kind, runner) {
  if (currentJob && currentJob.state === 'running') {
    return { ok: false, error: '已有任务正在运行（' + currentJob.kind + '），请等它结束。' }
  }
  const job = {
    id: kind + '-' + Date.now().toString(36),
    kind,
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    log: [],
    result: null,
    error: ''
  }
  currentJob = job
  const onLog = (line) => job.log.push(new Date().toLocaleTimeString('zh-CN') + '  ' + String(line))
  Promise.resolve()
    .then(() => runner(onLog))
    .then((result) => {
      job.state = 'done'
      job.result = result
      job.finishedAt = new Date().toISOString()
    })
    .catch((error) => {
      job.state = 'failed'
      job.error = String((error && error.message) || error)
      job.finishedAt = new Date().toISOString()
    })
    // Installing or removing markitdown changes what a probe would find, so the
    // cached sweep is dropped rather than shown for up to probeTtlMs.
    .then(() => invalidateProbeCache())
  return { ok: true, job: { id: job.id, kind, state: 'running' } }
}

function reply(res, status, payload) {
  let body
  try {
    body = JSON.stringify(payload)
  } catch (error) {
    status = 500
    body = JSON.stringify({ ok: false, error: '结果无法序列化：' + String((error && error.message) || error) })
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > 64 * 1024) break
      chunks.push(chunk)
    }
  } catch {
    return {}
  }
  if (!chunks.length) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Where a试转 artifact goes: the configured tmpDir, or right beside the source.
 *
 * The name is fixed (`<stem>-test.md`) on purpose. It deliberately does NOT
 * match the tool's `<stem>-<8hex>.md` cache pattern, so a试转 can never be
 * mistaken for a cached conversion, never shows up in `action:"clean"`, and
 * never accumulates: each试转 overwrites the previous one.
 */
function testTarget(cfg, srcAbs) {
  const configured = String(cfg.tmpDir || '').trim()
  const dir = configured ? path.resolve(configured) : path.dirname(srcAbs)
  return path.join(dir, safeBaseName(srcAbs) + '-test.md')
}

/**
 * Convert one file on demand, straight from the settings page.
 *
 * This is the "does it actually work on this machine?" button: it runs exactly
 * the converter chain the tool uses, reports which converter won and whether it
 * was MarkItDown or the built-in fallback, and returns a short preview — all
 * without a model turn and without touching the tool's cache.
 */
async function runConvertTest(cfg, srcAbs) {
  const startedAt = Date.now()
  const cls = classify(srcAbs)
  let st = null
  try { st = fs.statSync(srcAbs) } catch { st = null }
  if (!st || !st.isFile()) return { ok: false, error: '文件不存在或不是普通文件：' + srcAbs }
  if (cls.kind === 'plain') {
    return {
      ok: true,
      skipped: true,
      sourcePath: srcAbs,
      sourceKind: cls.label,
      elapsedMs: Date.now() - startedAt,
      message: '「' + cls.label + '」直接用 read 读取即可，不需要转换。'
    }
  }

  const dst = testTarget(cfg, srcAbs)
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
  } catch (error) {
    return { ok: false, error: '无法创建输出目录：' + String((error && error.message) || error) }
  }

  const result = await convertFile({ srcPath: srcAbs, dstPath: dst, cfg, force: true })
  if (!result.ok) {
    return {
      ok: false,
      sourcePath: srcAbs,
      sourceKind: cls.label,
      converterAttempts: (result.attempts || []).map((a) => String((a && a.reason) || (a && a.id) || a)),
      notices: result.probeNotes || [],
      elapsedMs: Date.now() - startedAt,
      error: String(result.error || '转换失败')
    }
  }

  const info = analyzeMarkdown(dst, { headChars: 501 })
  const stamp = readFidelityMarker(dst)
  return {
    ok: true,
    sourcePath: srcAbs,
    sourceKind: cls.label,
    sourceBytes: st.size,
    markdownPath: dst,
    markdownBytes: info.bytes,
    lineCount: info.lines,
    estimatedTokens: info.tokens,
    converter: stamp ? stamp.converter : result.converter,
    converterLabel: stamp
      ? converterLabelFor(stamp.converter, result.converterLabel || '')
      : (result.converterLabel || ''),
    fidelity: stamp && stamp.fidelity ? stamp.fidelity : result.fidelity,
    preview: info.head.length > 500 ? info.head.slice(0, 500) : info.head,
    previewTruncated: info.head.length > 500,
    notices: result.probeNotes || [],
    elapsedMs: Date.now() - startedAt
  }
}

async function buildStatus(ctx, cfg, meta) {
  const probe = await probeConverters(cfg, { force: false })
  const active = probe.chain.length ? probe.chain[0] : null
  const usingFallback = !active || active.fidelity === 'limited'
  return {
    ok: true,
    plugin: {
      name: meta.name,
      version: meta.version,
      provider: meta.provider,
      tool: meta.toolName,
      tmpDir: cfg.tmpDir || '（源文件同目录）'
    },
    converter: {
      id: active ? active.id : '',
      label: active ? active.label : '无可用转换器',
      fidelity: active ? active.fidelity : 'none',
      usingFallback,
      summary: usingFallback
        ? '当前使用插件内置兜底转换（未使用 MarkItDown，保真度有限）'
        : '当前使用本机 MarkItDown 环境（保真度高）',
      chain: probe.chain.map((c) => ({ id: c.id, label: c.label, fidelity: c.fidelity })),
      pythonPrefer: probe.pythonPrefer || String(cfg.pythonPrefer || 'auto'),
      notices: probe.notes || []
    },
    snapshot: snapshotSummary(),
    job: jobView()
  }
}

function pickCandidate(cfg, wanted) {
  const list = pythonCandidates(cfg)
  if (wanted) {
    const hit = list.find((c) => commandOf(c) === wanted)
    if (hit) return hit
  }
  return list.length ? list[0] : null
}

/**
 * 列出「上一次工具调用看到的工作区」里的 Office / PDF 文件。
 *
 * 设置页拿不到 session（见 lib/recent.js），浏览器也不会给出文件对话框里的
 * 绝对路径，所以下拉只能靠扫一遍工作区。**只读**：不转换、不写盘、不碰缓存。
 * 每个上限都是有意的 —— 这段代码跑在服务 API 的同一个进程里，一个几十万文件
 * 的仓库不能把设置页拖死。
 */
function listWorkspaceOfficeFiles() {
  const out = { ok: true, root: '', truncated: false, files: [] }
  const root = String(lastWorkspace().root || '')
  if (!root) return out
  let rootStat = null
  try { rootStat = fs.statSync(root) } catch { rootStat = null }
  if (!rootStat || !rootStat.isDirectory()) return out
  out.root = root

  const found = []
  let entriesSeen = 0
  let truncated = false

  const walk = (dir, depth) => {
    if (truncated || depth > SCAN_MAX_DEPTH) return
    let entries = []
    // 子目录可能没权限、也可能在扫描途中被删掉，一律当作「这里没有」
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      entriesSeen += 1
      if (entriesSeen > SCAN_MAX_ENTRIES) {
        truncated = true
        return
      }
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SCAN_SKIP_DIRS.has(entry.name)) continue
        walk(abs, depth + 1)
        continue
      }
      // 只认普通文件：符号链接可能指向工作区之外，也可能成环
      if (!entry.isFile()) continue
      const cls = classify(entry.name)
      if (cls.kind !== 'office') continue
      let stat = null
      try { stat = fs.statSync(abs) } catch { stat = null }
      if (!stat) continue
      found.push({
        abs,
        rel: path.relative(root, abs).split(path.sep).join('/'),
        size: stat.size,
        ext: cls.ext,
        mtimeMs: stat.mtimeMs || 0
      })
    }
  }
  walk(root, 0)

  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  if (found.length > SCAN_MAX_FILES) truncated = true
  out.truncated = truncated
  out.files = found.slice(0, SCAN_MAX_FILES).map((f) => ({ abs: f.abs, rel: f.rel, size: f.size, ext: f.ext }))
  return out
}

export function createSettingsApi(ctx, cfg, meta) {
  async function handle(req, res) {
    let pathname = '/'
    try {
      const url = new URL(String(req.url || '/'), 'http://localhost')
      pathname = url.pathname
    } catch {
      return reply(res, 400, { ok: false, error: '无法解析请求 URL' })
    }
    const route = pathname.startsWith(API_BASE) ? pathname.slice(API_BASE.length) : pathname
    const method = String(req.method || 'GET').toUpperCase()

    try {
      if (method === 'GET' && (route === '/api/status' || route === '/api/status/')) {
        return reply(res, 200, await buildStatus(ctx, cfg, meta))
      }

      if (method === 'GET' && (route === '/api/job' || route === '/api/job/')) {
        return reply(res, 200, { ok: true, job: jobView() })
      }

      if (method === 'GET' && (route === '/api/probe' || route === '/api/probe/')) {
        /* Probing every interpreter is slow (several process spawns each), so
         * the result is cached for cfg.probeTtlMs and the page only forces a
         * fresh sweep when the user explicitly asks for one. */
        const force = /[?&]force=1/.test(String(req.url || ''))
        const envs = await inspectEnvironments(cfg, { force })
        return reply(res, 200, {
          ok: true,
          cached: envs.cached === true,
          budgetMs: envs.budgetMs || 0,
          python: {
            prefer: envs.pythonPrefer,
            active: envs.active,
            installTarget: envs.installTarget,
            candidates: envs.candidates
          },
          snapshot: envs.snapshot
        })
      }

      if (method === 'GET' && (route === '/api/workspace-files' || route === '/api/workspace-files/')) {
        /* 只读接口：给试转卡片提供「从最近的工作区里挑一个」的下拉数据。
         * 工作区来自上一次工具调用（lib/recent.js），没有就返回空列表，
         * 页面会继续让用户手填绝对路径。 */
        return reply(res, 200, listWorkspaceOfficeFiles())
      }

      if (method === 'POST' && route === '/api/convert-test') {
        const body = await readBody(req)
        const raw = typeof body.path === 'string' ? body.path.trim() : ''
        if (!raw) {
          return reply(res, 400, { ok: false, error: '请填写要试转的文件路径（绝对路径）。' })
        }
        if (!path.isAbsolute(raw)) {
          return reply(res, 400, { ok: false, error: '请填写绝对路径，例如 D:\\work\\报表.xlsx。' })
        }
        return reply(res, 200, await runConvertTest(cfg, path.normalize(raw)))
      }

      if (method === 'POST' && route === '/api/env/install') {
        const body = await readBody(req)
        const wanted = typeof body.target === 'string' ? body.target : ''
        const started = startJob('install', async (onLog) => {
          const candidate = pickCandidate(cfg, wanted)
          if (!candidate) throw new Error('没有找到任何 Python 解释器，无法安装 markitdown。')
          const target = await inspectEnvironments(cfg, {})
          const usable = target.candidates.find((c) => c.command === commandOf(candidate))
          if (usable && !usable.usable) throw new Error('该解释器无法运行：' + (usable.error || '未知原因'))
          if (usable && !usable.hasPip) throw new Error('该解释器没有 pip，无法安装。请换一个（如 DSH 自带运行时）。')
          if (usable && usable.hasMarkitdown) {
            const version = usable.markitdownVersion || ''
            const targetCmd = commandOf(candidate)
            const snap = readSnapshot()
            const same = !!snap && (snap.pythonCommand === targetCmd || (usable.executable && snap.python === usable.executable))
            if (same) {
              onLog('该解释器已经有 markitdown ' + version + '，并且已经登记在插件名下。')
              return { ok: true, already: true, recorded: true, target: targetCmd }
            }
            if (snap) {
              // Never overwrite a record pointing at another interpreter: doing so
              // would orphan the packages we installed there.
              onLog('环境记录目前指向另一个解释器：' + (snap.python || snap.pythonCommand || '未知')
                + '。为避免留下无人认领的包，本次不覆盖。若要改用当前解释器，请先点「卸载环境」。')
              return { ok: true, already: true, recorded: true, target: targetCmd, conflict: true }
            }
            onLog('该解释器已经有 markitdown ' + version + '，不重复安装；改为登记到插件名下，卸载插件时会一并移除。')
            const adopted = await adoptMarkitdown(candidate, { onLog })
            if (!adopted || !adopted.ok) {
              onLog('登记失败：' + ((adopted && adopted.error) || '未知原因') + '（markitdown 可以继续使用，只是卸载插件时不会动它。）')
              return { ok: true, already: true, recorded: false, target: targetCmd }
            }
            return {
              ok: true,
              already: true,
              recorded: true,
              adopted: true,
              target: targetCmd,
              packages: (adopted.added || []).length,
              kept: (adopted.keep || []).length
            }
          }
          return installMarkitdown(cfg, candidate, { onLog })
        })
        return reply(res, started.ok ? 202 : 409, started)
      }

      if (method === 'POST' && route === '/api/env/uninstall') {
        const started = startJob('uninstall', async (onLog) => uninstallMarkitdown({ onLog }))
        return reply(res, started.ok ? 202 : 409, started)
      }

      return reply(res, 404, { ok: false, error: '未知接口：' + method + ' ' + pathname })
    } catch (error) {
      return reply(res, 500, { ok: false, error: String((error && error.message) || error) })
    }
  }

  return handle
}

/**
 * Register the settings API on the host web server.
 * Returns a disposer, or `null` when the host has no web server (CLI profiles).
 */
export function registerSettingsApi(ctx, cfg, meta) {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') return null
  const handle = createSettingsApi(ctx, cfg, meta)
  return webServer.register({ kind: 'prefix', path: API_BASE, handler: handle })
}