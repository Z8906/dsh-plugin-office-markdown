/*!
 * dsh-plugin-office-markdown — settings-page HTTP API (host half)
 *
 * The settings page lives in the client half, which cannot touch the
 * filesystem, spawn pip, or probe interpreters. This module exposes the small
 * JSON surface it needs over the host `webServer` service under the single
 * prefix `/office-markdown`:
 *
 *   GET  /office-markdown/api/status          fast — current converter + snapshot + job
 *   GET  /office-markdown/api/probe           slow — full per-interpreter inspection
 *   GET  /office-markdown/api/job             progress of a running install/uninstall
 *   POST /office-markdown/api/env/install     { target? } — pip install "markitdown[all]",
 *                                             or record an existing install so the
 *                                             uninstaller knows what to remove
 *   POST /office-markdown/api/env/uninstall   pip uninstall exactly what we installed
 *
 * Install and uninstall run as a background job: the HTTP call returns at once
 * and the page polls `/api/job`, so a multi-minute pip run cannot time out.
 */
import { probeConverters, pythonCandidates } from './convert.js'
import {
  adoptMarkitdown,
  commandOf,
  inspectEnvironments,
  installMarkitdown,
  readSnapshot,
  snapshotSummary,
  uninstallMarkitdown
} from './env.js'

export const API_BASE = '/office-markdown'
const JOB_MAX_LOG = 300

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
        const envs = await inspectEnvironments(cfg, {})
        return reply(res, 200, {
          ok: true,
          python: {
            prefer: envs.pythonPrefer,
            active: envs.active,
            installTarget: envs.installTarget,
            candidates: envs.candidates
          },
          snapshot: envs.snapshot
        })
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