/*!
 * dsh-plugin-office-markdown — host half
 *
 * Registers:
 *   - the `read_office_as_markdown` tool (Office/PDF -> Markdown spill),
 *   - a bundled runtime skill that tells the model to use it,
 *   - an optional guard that redirects a raw `read` of a binary Office/PDF
 *     file to that tool.
 *
 * Everything is registered through `ctx.effect(...)`, and `config.enabled ===
 * false` short-circuits `apply()` before any registration happens: disabling
 * the plugin (config or DSH plugin manager) leaves the process exactly as if
 * the package were never installed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  classify,
  convertFile,
  ensureDirSync,
  estimateTokens,
  OFFICE_EXTS,
  probeConverters,
  pythonSourceLabel,
  safeBaseName,
  sha8
} from './convert.js'
import { registerSettingsApi } from './settings-api.js'
import {
  adoptMarkitdown,
  readSnapshot,
  snapshotSummary,
  uninstallMarkitdown
} from './env.js'

/* `defineTool` is the same helper `dsh-plugin-save-token` imports. A static
 * import is used on purpose: dynamic import + top-level await would make this
 * module's namespace asynchronous, and dsh's loader would then evaluate the
 * plugin object too late (the entry silently fails to activate). */
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'office-markdown'

export const inject = ['tools', 'skills']

const TOOL_NAME = 'read_office_as_markdown'
const SKILL_NAME = 'office-pdf-to-markdown'
const PROVIDER = 'dsh-plugin-office-markdown'

const DEFAULTS = Object.freeze({
  enabled: true,
  tmpDir: '',
  converter: 'auto',
  pythonPath: '',
  pythonPrefer: 'auto',
  allowUvxDownload: true,
  uvxExtras: 'markitdown[all]',
  fallbackEnabled: true,
  guardReadTool: true,
  probeTtlMs: 600000,
  timeoutMs: 300000,
  reuseFresh: true,
  maxPreviewChars: 4000,
  maxRowsPerSheet: 400,
  maxTableCols: 24,
  maxCellsPerSheet: 20000,
  registerSkill: true,
  registerSettings: true,
  autoAdoptEnv: true,
  removeEnvOnUninstall: true
})

/** Absolute directory of this module and of the plugin package itself. */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.dirname(HERE)

/** Read our own package version for the settings page; never fatal. */
function pluginVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const VERSION = pluginVersion()

const SKILL_CONTENT = `# Office / PDF 文件先转 Markdown 再读取

遇到 .docx、.xlsx、.pptx、.pdf、.csv 等 Office / PDF 文件时，不要直接读原文件，必须先调用 read_office_as_markdown 工具转换成 Markdown，再读取转换后的 .md 文件。转换结果保存在工作区里（就在源文件旁边），按需读取，避免全文注入上下文。

## 为什么

Office / PDF 是二进制压缩容器。直接 read 只会得到乱码或超长的 XML 片段，既浪费 token 又拿不到有用信息。先转成 Markdown 再按需读取，可以显著降低上下文占用。

## 标准流程

1. \`read_office_as_markdown({ path: "报表.xlsx" })\`
   - 返回转换后的 .md 路径（**不会**把全文塞进上下文），例如 \`报表-3f9a2c1d.md\`（就生成在源文件旁边）。
2. 用 read 工具读取该 .md 文件，按需分段读取：
   - 先读开头（例如 \`read({ file_path: "...", limit: 200 })\`）确认结构，再决定要不要继续读。
   - 不要一次把整个 .md 读进上下文。
3. 如果只需要某一部分（某个工作表 / 某张幻灯片 / 某个章节），先用 grep 在该 .md 内定位，再定点读取。

## 参数说明

- \`path\`：工作区内的文件路径，相对或绝对均可（\`action: "status"\` 时可省略）。
- \`action\`：\`auto\`（默认，自动判断）/ \`convert\`（强制转换）/ \`read\`（读取已转换结果的开头）/ \`status\`（查看当前可用的转换器，以及每个 Python 环境有没有 markitdown）。
- \`force\`：\`true\` 时忽略缓存重新转换。
- \`preview\`：可选，返回转换后 Markdown 开头 N 个字符（默认 0，即只给路径，最省 token）。

## 注意

- 纯文本 / Markdown / CSV 等文件本来就能直接读取，工具会直接告知，不需要转换（CSV 转 Markdown 表格通常会**更费** token）。
- 转换在本地完成，不修改原文件，不消耗任何 API 额度。
- 转换结果 \`.md\` 就写在**源文件旁边**（同目录），除此之外不产生任何临时目录、登记表或缓存元数据。用完之后由用户自行删除。
- 用户想提升保真度时，让他们打开 DSH 设置里的「Office 转换」页面：那里能查看本机 Python 环境、一键配置 MarkItDown、以及卸载插件配置的环境。**不要**自己执行 pip 安装。
- 卸载这个插件时，它会自动把设置页登记过的 MarkItDown 与依赖一并卸载；但**禁用 / 关闭 / 重启插件都不会卸载任何 Python 包**。
- 如果转换失败，工具会给出明确错误；此时可以回退到直接读取，或提示用户打开设置页面配置 MarkItDown。
`

function loggerFor(ctx) {
  try {
    if (ctx && ctx.logger && typeof ctx.logger.info === 'function') return ctx.logger
  } catch { /* ignore */ }
  return null
}

function humanBytes(n) {
  if (!Number.isFinite(n)) return '未知'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}

function workspaceRootOf(ctx, exec) {
  try {
    const sessions = ctx.get('sessions')
    const id = exec && exec.agent ? exec.agent.id : undefined
    const session = id && sessions ? sessions.get(id) : undefined
    const cwd = session && session.header ? session.header.cwd : undefined
    if (typeof cwd === 'string' && cwd) return cwd
  } catch { /* ignore */ }
  return undefined
}

function resolveInputPath(rawPath, root) {
  const cwd = root || process.cwd()
  return path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(cwd, rawPath)
}

function displayPath(abs, root) {
  if (!root) return abs
  try {
    const rel = path.relative(root, abs)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/')
  } catch { /* ignore */ }
  return abs
}

function configSignature(cfg) {
  return JSON.stringify([
    cfg.converter,
    cfg.uvxExtras,
    cfg.fallbackEnabled,
    cfg.maxRowsPerSheet,
    cfg.maxTableCols,
    cfg.maxCellsPerSheet
  ])
}

function buildDefinition(ctx, cfg) {
  return defineTool({
    name: TOOL_NAME,
    description:
      '把工作区里的 Office / PDF 文件（.docx、.xlsx、.pptx、.pdf、.xls、.odt、.epub 等）先用 MarkItDown 转成 Markdown，' +
      '把结果写成源文件旁边的同名 .md，只返回该 .md 的路径和体积/token 估算，**不把全文塞进上下文**；随后用 read 工具按需读取该 .md。' +
      '纯文本 / Markdown / CSV 文件本来就能直接读取，本工具会直接告知，不需要转换。' +
      '转换在本地完成，不改动原文件。当模型需要读取 .docx/.xlsx/.pptx/.pdf 等文件时必须先调用本工具。',
    parameters: {
      path: {
        type: 'string',
        description: '要处理的文件路径（相对工作区或绝对路径）。action 为 "status" 时可省略'
      },
      action: {
        type: 'string',
        description:
          "动作：'auto'（默认，自动判断类型并转换或提示直接读取）、'convert'（强制转换）、'read'（读取已转换结果的开头）、'status'（查看当前可用的转换器与 Python 环境）"
      },
      force: {
        type: 'boolean',
        description: 'true 时忽略已有转换结果，重新转换'
      },
      preview: {
        type: 'number',
        description: '可选：返回转换后 Markdown 开头的字符数（默认 0 = 只返回路径，最省 token）'
      }
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(args, value) {
        return [{ type: 'text', text: renderResult(value) }]
      }
    },
    execute: async (args, exec) => { const v = await executeTool(ctx, cfg, args || {}, exec); return JSON.parse(JSON.stringify(v)) }
  })
}

function renderResult(value) {
  if (!value || typeof value !== 'object') return '（无结果）'
  if (value.status === 'probe') {
    const lines = ['🔍 转换器探测结果']
    for (const item of value.converters || []) lines.push('  • ' + item)
    for (const note of value.notices || []) lines.push('  ! ' + note)
    const pythons = value.pythons || []
    if (pythons.length) {
      lines.push('')
      lines.push('🐍 Python 环境（pythonPrefer：' + (value.pythonPrefer || 'auto') + '；按此顺序探测，第一个装了 markitdown 的胜出）')
      const firstOk = pythons.find((p) => p.ok)
      for (const p of pythons) {
        const used = firstOk && p === firstOk
        const mark = p.ok ? (used ? '✅ 使用中' : '✅ 可用  ') : '❌ 未安装'
        const why = p.ok ? '' : '  ← ' + (p.reason || '无 markitdown')
        lines.push('  ' + mark + '  ' + p.cmd + '   [' + pythonSourceLabel(p.source) + ']' + why)
      }
      lines.push('  提示：想固定用某一个，把它的路径填进配置 pythonPath；想换探测顺序，改 pythonPrefer（auto / bundled / system / config）。')
    }
    const snap = value.snapshot || {}
    lines.push('')
    if (snap.present) {
      lines.push('📦 环境记录：' + (snap.adopted ? '已接管 ' : '已安装 ') + (snap.python || '未知解释器') +
        '（' + (snap.installedAt || '未知时间') + '）：' + (snap.added || []).length + ' 个包由本插件负责'
        + (snap.keep && snap.keep.length ? '，另有 ' + snap.keep.length + ' 个包被运行时共用、保留' : '') + '。')
      lines.push('   在 DSH 里卸载本插件时，这些包会被自动 pip uninstall。')
    } else {
      lines.push('📦 环境记录：无 —— markitdown 不是由本插件安装或登记的，卸载插件时不会卸载任何 Python 包。')
      lines.push('   想让它也一并清理，就在设置页点一次「一键配置」完成登记。')
    }
    lines.push('   打开 DSH 设置里的「Office 转换」页面，可以图形化地检查环境 / 一键配置 MarkItDown。')
    return lines.join('\n')
  }
  if (!value.ok) {
    const lines = ['❌ 处理失败', value.error || '未知错误']
    if (value.sourcePath) lines.push('源文件：' + value.sourcePath)
    if (value.fallbackHint) lines.push('建议：' + value.fallbackHint)
    return lines.join('\n')
  }
  if (value.status === 'direct-read') {
    return [
      '📄 ' + value.sourcePath + ' 是 ' + (value.sourceKind || '纯文本') + '，可以直接读取，无需转换。',
      value.guidance
    ].filter(Boolean).join('\n')
  }
  const lines = []
  lines.push((value.cached ? '♻️ 已有转换结果' : '✅ 已转换为 Markdown') + '：' + value.sourcePath)
  lines.push('• 源文件：' + value.sourcePath + '（' + humanBytes(value.sourceBytes) + '，未修改）')
  lines.push(
    '• Markdown：' + value.markdownPath + '（' + humanBytes(value.markdownBytes) +
    '，约 ' + (value.estimatedTokens || 0).toLocaleString('en-US') + ' tokens）'
  )
  lines.push('• 转换器：' + (value.converterLabel || value.converter) + '（保真度：' + (value.fidelity === 'limited' ? '有限' : '高') + '）')
  if (value.converterNote) lines.push('• 说明：' + value.converterNote)
  for (const note of value.notices || []) lines.push('• 提示：' + note)
  lines.push('下一步：' + value.guidance)
  if (value.preview) {
    lines.push('')
    lines.push('--- 预览（前 ' + value.preview.length + ' 字符）---')
    lines.push(value.preview)
    if (value.previewTruncated) lines.push('…（预览已截断）')
  }
  return lines.join('\n')
}

function fail(message, extra = {}) {
  return { ok: false, error: message, ...extra }
}

async function executeTool(ctx, cfg, args, exec) {
  const signal = exec && exec.signal ? exec.signal : undefined
  const root = workspaceRootOf(ctx, exec)
  const action = String(args.action || 'auto').toLowerCase()

  if (action === 'status') {
    const probe = await probeConverters(cfg, { signal, force: true })
    return {
      ok: true,
      status: 'probe',
      converters: probe.chain.map((c) => c.label + ' [' + c.id + ']'),
      pythons: probe.pythonProbes || [],
      pythonPrefer: probe.pythonPrefer || String(cfg.pythonPrefer || 'auto'),
      notices: probe.notes || [],
      snapshot: snapshotSummary()
    }
  }

  const rawPath = String(args.path || '').trim()
  if (!rawPath) return fail('缺少 path 参数。用法：read_office_as_markdown({ path: "报表.xlsx" })')

  const absSrc = resolveInputPath(rawPath, root)
  if (!fs.existsSync(absSrc)) {
    return fail(
      '文件不存在：' + absSrc,
      { sourcePath: rawPath, fallbackHint: '请确认路径是否正确（相对路径以工作区 ' + (root || process.cwd()) + ' 为基准）。' }
    )
  }

  let st
  try {
    st = fs.statSync(absSrc)
  } catch (error) {
    return fail('无法读取文件信息：' + String((error && error.message) || error), { sourcePath: rawPath })
  }
  if (!st.isFile()) return fail('不是文件（可能是目录）：' + absSrc, { sourcePath: rawPath })

  const cls = classify(absSrc)
  const shownSrc = displayPath(absSrc, root)

  // Plain text / Markdown / CSV: reading directly is cheaper than converting.
  if (action === 'auto' && cls.kind === 'plain') {
    const csvLike = cls.ext === '.csv' || cls.ext === '.tsv'
    return {
      ok: true,
      status: 'direct-read',
      sourcePath: shownSrc,
      sourceAbsolutePath: absSrc,
      sourceBytes: st.size,
      sourceKind: cls.label,
      guidance: csvLike
        ? '这是分隔符文本，直接用 read 工具读取最省 token（转成 Markdown 表格通常更费）。若确实需要结构化 Markdown 表格，再调用本工具并传 action:"convert"。'
        : '请直接用 read 工具读取 ' + shownSrc + '，不要转换。'
    }
  }

  if (action === 'read') {
    const existing = await findExisting(ctx, cfg, absSrc, st, root)
    if (!existing) {
      return fail('还没有转换结果，请先执行转换（action:"convert" 或不传 action）。', { sourcePath: shownSrc })
    }
    return readExisting(existing, shownSrc, args)
  }

  // convert / auto on Office or unknown-binary files
  ensureTmpDir(ctx, cfg, absSrc, root)
  const target = conversionTarget(ctx, cfg, absSrc, st, root)
  const cached = cfg.reuseFresh !== false && fs.existsSync(target.absDst) && safeSize(target.absDst) > 0

  let result
  if (cached && !args.force) {
    result = {
      ok: true,
      converter: 'cache',
      converterLabel: '已有转换结果（未重新转换）',
      fidelity: 'high',
      converterNote: null,
      probeNotes: []
    }
  } else {
    result = await convertFile({
      srcPath: absSrc,
      dstPath: target.absDst,
      cfg,
      signal,
      force: !!args.force
    })
  }

  if (!result.ok) {
    return fail(result.error || '转换失败', {
      sourcePath: shownSrc,
      sourceAbsolutePath: absSrc,
      converterAttempts: result.attempts || [],
      notices: result.probeNotes || [],
      fallbackHint:
        '可回退为直接用 read 工具读取 ' + shownSrc + '（可能得到乱码），或请用户手动处理：' +
        '安装 uv 后重试（uvx markitdown 无需永久安装），或执行 pip install "markitdown[all]"。' +
        '也可以传 action:"status" 查看当前可用的转换器。'
    })
  }

  let content = ''
  try {
    content = fs.readFileSync(target.absDst, 'utf8')
  } catch { /* ignore */ }
  const mdBytes = safeSize(target.absDst) || Buffer.byteLength(content, 'utf8')

  const previewLimit = Math.max(0, Math.min(Number(args.preview) || 0, cfg.maxPreviewChars || 4000))
  const preview = previewLimit > 0 ? content.slice(0, previewLimit) : ''

  const notices = []
  if (result.converter === 'cache') notices.push('命中缓存：源文件未变化，直接复用已有 .md（如需强制重转请传 force:true）。')
  if (cls.kind === 'unknown') notices.push('无法从扩展名判断类型，已按二进制处理。')
  if (result.fidelity === 'limited') notices.push('未使用 MarkItDown，保真度有限（见上方说明）。')

  return {
    ok: true,
    status: result.converter === 'cache' ? 'cached' : 'converted',
    cached: result.converter === 'cache',
    sourcePath: shownSrc,
    sourceAbsolutePath: absSrc,
    sourceBytes: st.size,
    sourceKind: cls.label,
    markdownPath: target.shownDst,
    markdownAbsolutePath: target.absDst,
    markdownBytes: mdBytes,
    estimatedTokens: estimateTokens(content),
    converter: result.converter,
    converterLabel: result.converterLabel,
    fidelity: result.fidelity,
    converterNote: result.converterNote,
    preview: preview || undefined,
    previewTruncated: previewLimit > 0 && content.length > previewLimit,
    notices,
    guidance:
      '请用 read 工具按需读取 ' + target.shownDst +
      '（建议先读前 100~200 行确认结构，再用 grep 定位需要的片段；不要一次性读入整个文件）。'
  }
}

function safeSize(p) {
  try { return fs.statSync(p).size } catch { return 0 }
}

function ensureTmpDir(ctx, cfg, absSrc, root) {
  const dir = tmpDirFor(cfg, absSrc, root)
  ensureDirSync(dir)
  return dir
}

function tmpDirFor(cfg, absSrc, root) {
  const d = cfg.tmpDir === undefined || cfg.tmpDir === null ? '' : String(cfg.tmpDir)
  // 默认（tmpDir 为空）：与源文件同目录，转换产物就躺在原文件旁边。
  if (!d) return path.dirname(absSrc)
  const base = root || path.dirname(absSrc)
  return path.isAbsolute(d) ? d : path.join(base, d)
}

function conversionTarget(ctx, cfg, absSrc, st, root) {
  const dir = tmpDirFor(cfg, absSrc, root)
  const hash = sha8(absSrc + '|' + st.size + '|' + st.mtimeMs + '|' + configSignature(cfg))
  const absDst = path.join(dir, safeBaseName(absSrc) + '-' + hash + '.md')
  return { absDst, shownDst: displayPath(absDst, root) }
}

async function findExisting(ctx, cfg, absSrc, st, root) {
  const target = conversionTarget(ctx, cfg, absSrc, st, root)
  if (fs.existsSync(target.absDst) && safeSize(target.absDst) > 0) return target
  return null
}

function readExisting(target, shownSrc, args) {
  let content = ''
  try { content = fs.readFileSync(target.absDst, 'utf8') } catch { /* ignore */ }
  const limit = Math.max(0, Math.min(Number(args.preview) || 2000, 4000))
  const preview = content.slice(0, limit)
  return {
    ok: true,
    status: 'converted',
    cached: true,
    sourcePath: shownSrc,
    markdownPath: target.shownDst,
    markdownAbsolutePath: target.absDst,
    markdownBytes: safeSize(target.absDst),
    estimatedTokens: estimateTokens(content),
    converterLabel: '已有转换结果',
    fidelity: 'high',
    preview,
    previewTruncated: content.length > limit,
    guidance: '如需完整内容，请用 read 工具分段读取 ' + target.shownDst + '。'
  }
}

/* ------------------------------------------------------------------ */
/* uninstalling the plugin also uninstalls the environment it recorded  */
/* ------------------------------------------------------------------ */

/** Logging must never break a disposal path. */
function safeLog(logger, level, message) {
  try {
    if (logger && typeof logger[level] === 'function') logger[level]('[' + PROVIDER + '] ' + message)
  } catch { /* ignore */ }
}

/**
 * True only when this package has really been **uninstalled** from the profile.
 *
 * Being disposed is not enough: Cordis disposes a plugin when the app shuts
 * down, when the user merely disables it, and when the profile is reloaded.
 * A real removal is the only case where BOTH the package directory is gone AND
 * no profile config still references us — so both are required before anything
 * is uninstalled. A false negative only leaves packages behind; a false
 * positive would silently break the user's Python environment, so the check
 * errs toward doing nothing.
 */
function removalConfirmed() {
  try {
    if (fs.existsSync(path.join(PACKAGE_ROOT, 'lib', 'index.js'))) return false
  } catch {
    return false
  }
  const root = path.join(os.homedir(), '.dsh', 'profiles')
  let profiles = []
  try {
    profiles = fs.readdirSync(root)
  } catch {
    return false
  }
  for (const profile of profiles) {
    for (const file of ['cordis.patch.yml', 'cordis.patch.yaml', 'cordis.yml', 'package.json']) {
      const candidate = path.join(root, profile, file)
      try {
        if (!fs.existsSync(candidate)) continue
        if (fs.readFileSync(candidate, 'utf8').includes('office-markdown')) return false
      } catch {
        return false
      }
    }
  }
  return true
}

async function runEnvRemoval(cfg, logger) {
  try {
    if (cfg && cfg.removeEnvOnUninstall === false) return
    const snap = readSnapshot()
    if (!snap) return
    const count = Array.isArray(snap.added) ? snap.added.length : 0
    safeLog(logger, 'info', '插件已从 profile 移除，正在一并卸载登记过的 ' + count + ' 个 Python 包…')
    const result = await uninstallMarkitdown({})
    if (result && result.error) safeLog(logger, 'warn', '环境清理失败：' + result.error)
  } catch (error) {
    safeLog(logger, 'warn', '环境清理异常：' + String((error && error.message) || error))
  }
}

/**
 * Poll for a short while after disposal: the loader may delete the package
 * directory a moment after our fiber is released. The first confirmed removal
 * wins; anything that is only a shutdown, a disable or a reload is left alone.
 */
function scheduleRemovalCleanup(cfg, logger) {
  const delays = [1500, 3000, 6000, 12000]
  let fired = false
  for (const ms of delays) {
    const timer = setTimeout(() => {
      if (fired) return
      let gone = false
      try {
        gone = removalConfirmed()
      } catch {
        gone = false
      }
      if (!gone) return
      fired = true
      void runEnvRemoval(cfg, logger)
    }, ms)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }
}

/**
 * The DSH-owned runtime Python is the environment this plugin may clean up
 * later, so record it once if markitdown is already there and nothing has been
 * recorded yet. An interpreter the user installed themselves is deliberately
 * left alone — the plugin only ever removes what it can prove it brought in.
 */
function scheduleAutoAdoptEnv(cfg) {
  if (cfg.autoAdoptEnv === false) return
  const timer = setTimeout(() => { void autoAdoptEnv(cfg) }, 5000)
  if (timer && typeof timer.unref === 'function') timer.unref()
}

async function autoAdoptEnv(cfg) {
  try {
    if (readSnapshot()) return
    const probe = await probeConverters(cfg, { force: false })
    const entry = (probe.chain || []).find((c) => c && c.id === 'python-module' && c.python)
    if (!entry) return
    if (entry.python.source !== 'bundled') return
    await adoptMarkitdown(entry.python, {})
  } catch { /* best effort only */ }
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) }

  if (cfg.enabled === false) {
    const logger = loggerFor(ctx)
    if (logger) logger.info('[' + PROVIDER + '] enabled=false：未注册工具、技能或守卫。')
    return
  }

  const tools = ctx.get('tools')
  if (!tools || typeof tools.register !== 'function') {
    const logger = loggerFor(ctx)
    if (logger) logger.warn('[' + PROVIDER + '] 未找到 tools 服务，插件未注册。')
    return
  }

  ctx.effect(() => tools.register(buildDefinition(ctx, cfg)), PROVIDER + ': tool ' + TOOL_NAME)

  if (cfg.registerSkill !== false) {
    const skills = ctx.get('skills')
    if (skills && typeof skills.register === 'function') {
      ctx.effect(
        () =>
          skills.register({
            name: SKILL_NAME,
            description:
              '遇到 .docx、.xlsx、.pptx、.pdf、.csv 等 Office / PDF 文件时，必须先调用 read_office_as_markdown 转成 Markdown，再读取 .md 结果：转换结果就在源文件旁边（工作区里），按需读取，避免全文注入上下文。',
            whenToUse:
              '当需要读取工作区里的 Office（Word/Excel/PowerPoint）或 PDF 文件，或用户要求总结/分析这类文件内容时。',
            source: 'runtime',
            provider: PROVIDER,
            content: SKILL_CONTENT,
            invocation: { modelInvocable: true, userInvocable: true }
          }),
        PROVIDER + ': skill ' + SKILL_NAME
      )
    }
  }

  if (cfg.guardReadTool !== false && typeof tools.guard === 'function') {
    ctx.effect(
      () => tools.guard((execution) => guardRead(ctx, execution)),
      PROVIDER + ': read guard'
    )
  }

  // Settings page backend. `webServer` is deliberately NOT in `inject`: a
  // profile without a web server (a plain CLI session) must keep the tool and
  // skill working. `ctx.inject` starts a nested fiber that waits for the
  // service instead, and that fiber is owned by ours, so it is disposed with
  // the plugin.
  if (cfg.registerSettings !== false) {
    try {
      ctx.inject(['webServer'], (child) => {
        child.effect(
          () =>
            registerSettingsApi(child, cfg, {
              name: PROVIDER,
              version: VERSION,
              provider: PROVIDER,
              toolName: TOOL_NAME
            }),
          PROVIDER + ': settings API'
        )
      })
    } catch (error) {
      const logger = loggerFor(ctx)
      if (logger) logger.warn('[' + PROVIDER + '] 设置页面接口注册失败：' + String((error && error.message) || error))
    }
  }

  // Conversion itself leaves NOTHING behind: a single `.md` next to the source
  // file, owned by the user — no temp directory, no registry, no sidecar
  // metadata. The one thing that *can* survive is the environment the plugin
  // recorded when it was configured, so that snapshot is released when — and
  // only when — the plugin is really uninstalled from the profile.
  scheduleAutoAdoptEnv(cfg)

  try {
    const logger = loggerFor(ctx)
    ctx.effect(
      () => () => scheduleRemovalCleanup(cfg, logger),
      PROVIDER + ': uninstall cleanup'
    )
  } catch (error) {
    safeLog(loggerFor(ctx), 'warn', '卸载清理钩子注册失败：' + String((error && error.message) || error))
  }
}

function guardRead(ctx, execution) {
  try {
    if (!execution || execution.name !== 'read') return undefined
    const args = execution.arguments || {}
    const raw = args.file_path || args.path || args.filePath || args.filename
    if (typeof raw !== 'string' || !raw) return undefined
    const cls = classify(raw)
    if (cls.kind !== 'office') return undefined
    const shown = raw.replace(/\\/g, '/')
    return (
      '「' + shown + '」是 ' + cls.label + '（' + cls.ext + '），属于二进制压缩容器，直接读取会得到乱码并浪费 token。' +
      '请先调用 ' + TOOL_NAME + '({ path: "' + shown + '" }) 转换成 Markdown，再 read 生成的 .md 文件。' +
      '（如确认要强行直接读取，可用 read_office_as_markdown 之外的路径，或请用户关闭 office-markdown 的 guardReadTool。）'
    )
  } catch {
    return undefined
  }
}

export { SKILL_CONTENT, TOOL_NAME, SKILL_NAME, DEFAULTS }