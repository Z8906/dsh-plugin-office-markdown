/*!
 * dsh-plugin-office-markdown — converter core (host half)
 *
 * Responsibilities:
 * - classify a workspace path as Office/PDF (needs conversion) or plain text;
 * - probe the converter chain in the user's required priority order:
 *     1. `uvx markitdown`          (no permanent install)
 *     2. local `markitdown` CLI
 *     3. `python -m markitdown`
 *     4. bundled fallback (fallback.py, needs a local Python, limited fidelity)
 *     5. bundled pure-Node fallback (fallback-node.js, NO Python, NO network)
 * - run the conversion into a workspace temp directory, never touching the
 *   source file, and report honestly which converter produced the output.
 *
 * Pure Node standard library: no @deepseek-ai imports, no npm dependencies.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { convertFileNode, NODE_DEFAULTS } from './fallback-node.js'
import { runtimesRoot } from './paths.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FALLBACK_PY = path.join(HERE, 'fallback.py')
const FALLBACK_NODE = path.join(HERE, 'fallback-node.js')

/** Binary Office / PDF containers: converting them is what saves tokens. */
export const OFFICE_EXTS = Object.freeze({
  '.docx': 'Word 文档',
  '.doc': 'Word 97-2003 文档',
  '.docm': 'Word 宏文档',
  '.xlsx': 'Excel 工作簿',
  '.xlsm': 'Excel 宏工作簿',
  '.xls': 'Excel 97-2003 工作簿',
  '.pptx': 'PowerPoint 演示文稿',
  '.pptm': 'PowerPoint 宏演示文稿',
  '.ppt': 'PowerPoint 97-2003 演示文稿',
  '.pdf': 'PDF 文档',
  '.odt': 'OpenDocument 文本',
  '.ods': 'OpenDocument 表格',
  '.odp': 'OpenDocument 演示',
  '.rtf': 'RTF 文档',
  '.epub': 'EPUB 电子书',
  '.msg': 'Outlook 邮件',
  '.ipynb': 'Jupyter Notebook'
})

/** Text-ish formats the model may read directly (no conversion needed). */
export const PLAIN_EXTS = new Set([
  '.txt', '.md', '.markdown', '.mdx', '.csv', '.tsv', '.json', '.jsonl', '.ndjson',
  '.yaml', '.yml', '.xml', '.html', '.htm', '.log', '.ini', '.cfg', '.toml',
  '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sql', '.rst', '.tex',
  '.srt', '.vtt', '.gitignore', '.env', '.properties'
])

const CONVERTIBLE = new Set(Object.keys(OFFICE_EXTS))

export function extOf(filePath) {
  const base = path.basename(String(filePath || ''))
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.slice(i).toLowerCase()
}

/**
 * @returns {{kind:'office'|'plain'|'unknown', ext:string, label:string, convertible:boolean}}
 */
export function classify(filePath) {
  const ext = extOf(filePath)
  if (CONVERTIBLE.has(ext)) {
    return { kind: 'office', ext, label: OFFICE_EXTS[ext], convertible: true }
  }
  if (PLAIN_EXTS.has(ext)) return { kind: 'plain', ext, label: '纯文本', convertible: false }
  return { kind: 'unknown', ext, label: ext ? ext + ' 文件' : '未知类型', convertible: false }
}

/** Rough token estimate (CJK counts ~0.75 token/char, latin ~1 token/3.8 chars). */
export function estimateTokens(text) {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0x2e80 && c <= 0x9fff) cjk++
    else if (c >= 0xd800 && c <= 0xdfff) {
      cjk++
      i++
    } else if (c === 10 || c === 13 || c === 32 || c === 9) other++
    else other++
  }
  return Math.ceil(other / 3.8 + cjk * 0.75)
}

export function sha8(input) {
  return createHash('sha1').update(String(input)).digest('hex').slice(0, 8)
}

export function safeBaseName(filePath) {
  const base = path.basename(String(filePath || 'file'))
  const i = base.lastIndexOf('.')
  const stem = i > 0 ? base.slice(0, i) : base
  const cleaned = stem.replace(/[^0-9A-Za-z\u4e00-\u9fff._-]+/g, '_').replace(/^_+|_+$/g, '')
  return (cleaned || 'file').slice(0, 80)
}

/* ------------------------------------------------------------------ */
/* subprocess                                                          */
/* ------------------------------------------------------------------ */

const MAX_STDOUT = 262144
const MAX_STDERR = 65536

/**
 * Run one child process. Never rejects: every failure is reported as a value
 * so the caller can fall through the converter chain.
 */
export function run(cmd, args, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 300000
  const signal = options.signal
  return new Promise((resolve) => {
    if (signal && signal.aborted) {
      resolve({ ok: false, code: -1, stdout: '', stderr: 'aborted before start', aborted: true })
      return
    }
    let child
    try {
      child = spawn(cmd, args, {
        cwd: options.cwd,
        windowsHide: true,
        shell: false,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String((error && error.message) || error), spawnError: true })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* ignore */ }
    }, timeoutMs)
    const onAbort = () => { try { child.kill() } catch { /* ignore */ } }
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
      resolve(result)
    }

    if (child.stdout) child.stdout.on('data', (d) => { if (stdout.length < MAX_STDOUT) stdout += d.toString('utf8') })
    if (child.stderr) child.stderr.on('data', (d) => { if (stderr.length < MAX_STDERR) stderr += d.toString('utf8') })
    child.on('error', (error) => finish({ ok: false, code: -1, stdout, stderr: stderr + '\n' + String((error && error.message) || error), spawnError: true }))
    child.on('close', (code) => finish({ ok: !timedOut && code === 0, code, stdout, stderr, timedOut, aborted: !!(signal && signal.aborted) }))
  })
}

/* ------------------------------------------------------------------ */
/* converter probing                                                   */
/* ------------------------------------------------------------------ */

function discoverBundledPythons() {
  const out = []
  try {
    const root = runtimesRoot()
    for (const name of fs.readdirSync(root)) {
      const p = path.join(root, name, 'dependencies', 'python', 'python.exe')
      if (fs.existsSync(p)) out.push(p)
      const p2 = path.join(root, name, 'dependencies', 'python', 'bin', 'python3')
      if (fs.existsSync(p2)) out.push(p2)
    }
  } catch { /* no bundled runtime */ }
  return out
}

/** Chinese label for where a Python candidate came from. */
export function pythonSourceLabel(source) {
  if (source === 'config') return '配置 pythonPath'
  if (source === 'bundled') return 'DSH 自带运行时'
  return '系统 PATH'
}

export const PYTHON_PREFERS = ['auto', 'bundled', 'system', 'config']

/**
 * Ordered list of Python interpreters to try, honouring `cfg.pythonPrefer`.
 * Each entry carries its `source` so `action:"status"` can explain the order.
 * @returns {Array<{cmd: string, prefix: string[], source: string}>}
 */
export function pythonCandidates(cfg) {
  const out = []
  const seen = new Set()
  const push = (cmd, prefix, source) => {
    if (!cmd) return
    const key = cmd + ' ' + prefix.join(' ')
    if (seen.has(key)) return
    seen.add(key)
    out.push({ cmd, prefix, source: source || 'system' })
  }

  const configured = cfg && cfg.pythonPath ? String(cfg.pythonPath) : ''
  const bundled = discoverBundledPythons()
  const system = [['python', []], ['python3', []], ['py', ['-3']]]

  let prefer = String((cfg && cfg.pythonPrefer) || 'auto').toLowerCase()
  if (!PYTHON_PREFERS.includes(prefer)) prefer = 'auto'
  /* A mode that cannot be satisfied degrades to the full order rather than
   * leaving the plugin with no interpreter at all. */
  if (prefer === 'config' && !configured) prefer = 'auto'
  if (prefer === 'bundled' && bundled.length === 0) prefer = 'auto'

  if (prefer === 'config') {
    push(configured, [], 'config')
    return out
  }
  if (prefer === 'bundled') {
    for (const p of bundled) push(p, [], 'bundled')
    return out
  }
  if (prefer === 'system') {
    for (const [cmd, prefix] of system) push(cmd, prefix, 'system')
    for (const p of bundled) push(p, [], 'bundled')
    if (configured) push(configured, [], 'config')
    return out
  }
  if (configured) push(configured, [], 'config')
  for (const p of bundled) push(p, [], 'bundled')
  for (const [cmd, prefix] of system) push(cmd, prefix, 'system')
  return out
}

let probeCache = { at: 0, key: '', value: null }

/**
 * Probe the converter chain once (cached for `cfg.probeTtlMs`).
 * @returns {Promise<{chain: Array<object>, notes: string[]}>}
 */
export async function probeConverters(cfg, options = {}) {
  const key = JSON.stringify([
    cfg.pythonPath || '',
    cfg.pythonPrefer || 'auto',
    cfg.uvxExtras || '',
    cfg.allowUvxDownload !== false,
    cfg.fallbackEnabled !== false
  ])
  const ttl = Number.isFinite(cfg.probeTtlMs) ? cfg.probeTtlMs : 600000
  if (!options.force && probeCache.value && probeCache.key === key && Date.now() - probeCache.at < ttl) {
    return probeCache.value
  }

  const chain = []
  const notes = []
  const probeTimeout = 45000

  const uvx = await run('uvx', ['--version'], { timeoutMs: probeTimeout, signal: options.signal })
  if (uvx.ok) {
    chain.push({
      id: 'uvx',
      label: 'uvx markitdown（临时运行，无需永久安装）',
      fidelity: 'high',
      kind: 'uvx'
    })
  } else {
    notes.push('未检测到 uvx（' + firstLine(uvx.stderr) + '）')
  }

  const cli = await run('markitdown', ['--help'], { timeoutMs: probeTimeout, signal: options.signal })
  if (cli.ok) {
    chain.push({
      id: 'markitdown-cli',
      label: 'markitdown 命令行',
      fidelity: 'high',
      kind: 'cli'
    })
  } else {
    notes.push('未检测到 markitdown 命令（' + firstLine(cli.stderr) + '）')
  }

  let pythonHit = null
  const pythonProbes = []
  const candidates = pythonCandidates(cfg)
  /* `force` (which is what `action:"status"` passes) audits every candidate so
   * the user can see which interpreter actually holds markitdown; a normal
   * conversion stops at the first hit to stay fast. */
  const probeAll = options.probeAll === true || options.force === true
  for (const cand of candidates) {
    const r = await run(cand.cmd, [...cand.prefix, '-m', 'markitdown', '--help'], { timeoutMs: probeTimeout, signal: options.signal })
    pythonProbes.push({ cmd: cand.cmd, source: cand.source, ok: !!r.ok, reason: r.ok ? '' : firstLine(r.stderr) })
    if (r.ok) {
      if (!pythonHit) {
        pythonHit = { id: 'python-module', label: 'python -m markitdown（' + cand.cmd + '）', fidelity: 'high', kind: 'python', python: cand }
      }
      if (!probeAll) break
    }
  }
  if (pythonHit) chain.push(pythonHit)
  else if (candidates.length) notes.push('未检测到已安装 markitdown 的 Python 解释器（已检查 ' + candidates.length + ' 个候选，明细见下方）')
  else notes.push('没有可用的 Python 解释器候选（pythonPrefer=' + String(cfg.pythonPrefer || 'auto') + '）')

  if (cfg.fallbackEnabled !== false) {
    const py = pythonHit && pythonHit.python ? pythonHit.python : pythonCandidates(cfg)[0]
    if (py) {
      chain.push({
        id: 'builtin',
        label: '插件内置 Python 兜底转换器（保真度有限）',
        fidelity: 'limited',
        kind: 'builtin',
        python: py
      })
    } else {
      notes.push('未检测到 Python 解释器，已跳过 Python 兜底转换器（不影响 Node 兜底）')
    }
    chain.push({
      id: 'node-builtin',
      label: '插件内置 Node 兜底转换器（纯 Node，无需 Python 与网络，保真度有限）',
      fidelity: 'limited',
      kind: 'inline'
    })
  }

  const value = {
    chain,
    notes,
    pythonProbes,
    pythonPrefer: String(cfg.pythonPrefer || 'auto'),
    probedAt: Date.now()
  }
  probeCache = { at: Date.now(), key, value }
  if (options.force) probeCache.value = value
  return value
}

function firstLine(text) {
  const s = String(text || '').replace(/\r/g, '').trim()
  const line = s.split('\n').filter(Boolean).pop() || s.split('\n')[0] || ''
  return line.slice(0, 160)
}

/* ------------------------------------------------------------------ */
/* conversion                                                          */
/* ------------------------------------------------------------------ */

function buildSteps(converter, src, dst, cfg) {
  const extras = cfg.uvxExtras || 'markitdown[all]'
  switch (converter.kind) {
    case 'uvx':
      return [
        ['uvx', ['--from', extras, 'markitdown', src, '-o', dst]],
        ['uvx', [extras, src, '-o', dst]]
      ]
    case 'cli':
      return [['markitdown', [src, '-o', dst]]]
    case 'python':
      return [[converter.python.cmd, [...converter.python.prefix, '-m', 'markitdown', src, '-o', dst]]]
    case 'builtin':
      return [[
        converter.python ? converter.python.cmd : 'python',
        [
          ...(converter.python ? converter.python.prefix : []),
          FALLBACK_PY,
          '--input', src,
          '--output', dst,
          '--max-rows', String(cfg.maxRowsPerSheet || 400),
          '--max-cols', String(cfg.maxTableCols || 24),
          '--max-cells', String(cfg.maxCellsPerSheet || 20000)
        ]
      ]]
    default:
      return []
  }
}

async function runSteps(steps, options) {
  const failures = []
  for (const [cmd, args] of steps) {
    const r = await run(cmd, args, options)
    if (r.ok) return { ok: true, failure: null, failures }
    failures.push({ cmd: cmd + ' ' + args.join(' '), reason: r.timedOut ? '超时' : firstLine(r.stderr) || ('退出码 ' + r.code) })
    if (r.aborted) break
  }
  return { ok: false, failures }
}

/** The pure-Node fallback runs in-process: no Python, no child process, no network. */
function runInline(converter, srcPath, dstPath, cfg) {
  try { fs.rmSync(dstPath, { force: true }) } catch { /* ignore */ }
  convertFileNode(srcPath, dstPath, {
    maxRowsPerSheet: cfg.maxRowsPerSheet || NODE_DEFAULTS.maxRowsPerSheet,
    maxTableCols: cfg.maxTableCols || NODE_DEFAULTS.maxTableCols,
    maxCellsPerSheet: cfg.maxCellsPerSheet || NODE_DEFAULTS.maxCellsPerSheet
  })
  const stat = fs.statSync(dstPath)
  if (!stat || stat.size === 0) throw new Error('转换结果为空文件')
  return { ok: true, dstBytes: stat.size }
}

/**
 * Convert one file to Markdown.
 *
 * @returns {Promise<object>} a value object; `ok:false` carries a human error.
 */
export async function convertFile(ctx) {
  const { srcPath, dstPath, cfg, signal, force } = ctx
  const intended = cfg.converter && cfg.converter !== 'auto' ? cfg.converter : null

  const probe = await probeConverters(cfg, { signal, force: !!force })
  let chain = probe.chain
  if (intended) {
    const wanted = chain.filter((c) => c.kind === intended || c.id === intended)
    if (wanted.length) chain = wanted
  }
  if (!chain.length) {
    return { ok: false, error: '没有任何可用的转换器：uvx / markitdown 命令 / python -m markitdown / 内置兜底 全部不可用。', probe }
  }

  const attempts = []
  for (const converter of chain) {
    if (converter.kind === 'inline') {
      try {
        const inline = runInline(converter, srcPath, dstPath, cfg)
        return {
          ok: true,
          converter: converter.id,
          converterLabel: converter.label,
          fidelity: converter.fidelity,
          converterNote: '以上为插件内置 Node 兜底转换（纯 Node，未使用 MarkItDown），版式、图表、批注、图片、公式等可能缺失。',
          attempts,
          probeNotes: probe.notes,
          dstBytes: inline.dstBytes
        }
      } catch (error) {
        attempts.push({
          converter: converter.id,
          label: converter.label,
          failures: [{ cmd: converter.label, reason: firstLine(String((error && error.message) || error)) }]
        })
        continue
      }
    }

    const steps = buildSteps(converter, srcPath, dstPath, cfg)
    if (!steps.length) continue
    try { fs.rmSync(dstPath, { force: true }) } catch { /* ignore */ }
    const result = await runSteps(steps, { timeoutMs: cfg.timeoutMs, signal })
    if (!result.ok) {
      attempts.push({ converter: converter.id, label: converter.label, failures: result.failures })
      if (signal && signal.aborted) {
        return { ok: false, error: '转换已取消。', attempts, probe, aborted: true }
      }
      continue
    }
    let stat = null
    try { stat = fs.statSync(dstPath) } catch { /* ignore */ }
    if (!stat || stat.size === 0) {
      attempts.push({ converter: converter.id, label: converter.label, failures: [{ cmd: converter.label, reason: '转换结果为空文件' }] })
      continue
    }
    return {
      ok: true,
      converter: converter.id,
      converterLabel: converter.label,
      fidelity: converter.fidelity,
      converterNote: converter.kind === 'builtin'
        ? '以上为插件内置兜底转换（未使用 MarkItDown），版式、图表、批注、扫描件 OCR 等信息可能缺失。'
        : null,
      attempts,
      probeNotes: probe.notes,
      dstBytes: stat.size
    }
  }

  const last = attempts[attempts.length - 1]
  const detail = last && last.failures && last.failures.length
    ? last.failures.map((f) => '  - ' + f.cmd + ' → ' + f.reason).join('\n')
    : '  - 未知原因'
  return {
    ok: false,
    error: '所有可用转换器都失败了（最后尝试：' + ((last && last.label) || '无') + '）\n' + detail,
    attempts,
    probe,
    probeNotes: probe.notes
  }
}

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export const paths = { HERE, FALLBACK_PY, FALLBACK_NODE }