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
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  analyzeMarkdown,
  classify,
  converterLabelFor,
  convertFile,
  ensureDirSync,
  findLatestArtifact,
  listArtifacts,
  OFFICE_EXTS,
  probeConverters,
  pythonSourceLabel,
  readFidelityMarker,
  safeBaseName,
  sha8,
  sourceContentHash
} from './convert.js'
import {
  currentProfileDir,
  profilesRoot,
  removalLogPath,
  setProfileDir,
  watchdogLockPath
} from './paths.js'
import { spawnRemovalWatchdog } from './removal-watchdog.js'
import { registerSettingsApi } from './settings-api.js'
import {
  adoptMarkitdown,
  readSnapshot,
  snapshotPath,
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
  pruneStaleArtifacts: false,
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

遇到 .docx、.xlsx、.pptx、.pdf 等 Office / PDF 文件时，不要直接读原文件，必须先调用 read_office_as_markdown 工具转换成 Markdown，再读取转换后的 .md 文件。转换结果保存在工作区里（就在源文件旁边），按需读取，避免全文注入上下文。

## 为什么

Office / PDF 是二进制压缩容器。直接 read 只会得到乱码或超长的 XML 片段，既浪费 token 又拿不到有用信息。先转成 Markdown 再按需读取，可以显著降低上下文占用。

## 标准流程

1. \`read_office_as_markdown({ path: "报表.xlsx" })\`
   - 返回转换后的 .md 路径（**不会**把全文塞进上下文），例如 \`报表-3f9a2c1d.md\`（就生成在源文件旁边）。
   - 返回值里同时给出体积、行数、token 估算，以及一份**结构索引**（章节 / 工作表 / 幻灯片的标题与大致行号）。
   - 一次要处理多个文件或整个文件夹时，用 \`paths: ["a.xlsx", "b.docx"]\` 或直接传目录，不要一个文件来回一次。
2. 用 read 工具读取该 .md 文件，按需分段读取：
   - 先读开头（例如 \`read({ file_path: "...", limit: 200 })\`）确认结构，再决定要不要继续读。
   - **不要一次把整个 .md 读进上下文**：产物不会被裁剪，读多少完全由你控制。
3. 如果只需要某一部分（某个工作表 / 某张幻灯片 / 某个章节）：
   - 先 \`read_office_as_markdown({ path: "...", action: "outline" })\` 拿一份标题索引（**只读索引，绝不触发转换**），
   - 再用 grep 在该 .md 里定位，最后定点 read。

## 参数说明

- \`path\`：工作区内的文件**或目录**路径，相对或绝对均可（\`action: "status"\` 时可省略）。传目录时按扩展名找出其中的 Office / PDF 文件。
- \`paths\`：多个文件 / 目录的数组，一次调用批量转换（逐文件串行，结果按“一行一个文件”汇总）。
- \`action\`：\`auto\`（默认，自动判断）/ \`convert\`（强制转换）/ \`read\`（读取已转换结果的开头）/ \`outline\`（只给结构索引）/ \`clean\`（清理该源文件的陈旧产物）/ \`status\`（查看当前可用的转换器，以及每个 Python 环境有没有 markitdown）。
- \`force\`：\`true\` 时忽略缓存重新转换。
- \`preview\`：可选，返回转换后 Markdown 开头 N 个字符（默认 0，即只给路径，最省 token）。
- \`recursive\`：\`path\` 是目录时是否进子目录（默认 false，一次最多 200 个文件）。
- \`dryRun\`：只对 \`action: "clean"\` 有效，默认 \`true\`，只报告会删哪些陈旧产物。

## 注意

- 纯文本 / Markdown / CSV 等文件本来就能直接读取，工具会直接告知，不需要转换（CSV 转 Markdown 表格通常会**更费** token）。
- 转换在本地完成，不修改原文件，不消耗任何 API 额度。
- 转换结果 \`.md\` 就写在**源文件旁边**（同目录），除此之外不产生任何临时目录、登记表或缓存元数据。
- 同一个源文件反复改动时可能留下多份历史产物。要清理就用 \`action: "clean"\`（默认先干跑，确认后再传 \`dryRun: false\`），或请用户在配置里打开 \`pruneStaleArtifacts\`。**不要**自己用命令行删文件。
- 用户想提升保真度时，让他们打开 DSH 设置里的「Office 转换」页面：那里能查看本机 Python 环境、一键配置 MarkItDown、**试转一个文件确认转换链真的可用**、以及卸载插件配置的环境。**不要**自己执行 pip 安装。
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

/* ------------------------------------------------------------------ */
/* artifacts: volume, outline, reuse, cleanup                          */
/* ------------------------------------------------------------------ */

const OUTLINE_MAX_BYTES = 262144
const OUTLINE_MAX_ENTRIES = 40
const READ_LINE_HINT = 200
const MAX_EXPAND_FILES = 200
const LOUD_ARTIFACT_LINES = 4000

function fidelityWord(fidelity) {
  if (fidelity === 'limited') return '有限'
  if (fidelity === 'high') return '高'
  return '未知'
}

/**
 * A cheap table of contents for an artifact.
 *
 * MarkItDown emits a heading per workbook sheet, per slide and per Word
 * heading, so `## Sheet: 汇总` really is navigation: it lets the model ask for
 * one section instead of reading a whole workbook to find it. Only the head of
 * the file is scanned, so the cost stays bounded no matter how large the
 * artifact is; `truncated` says whether headings past that point were missed.
 */
function buildOutline(mdPath, options = {}) {
  const maxBytes = Math.max(4096, Number(options.maxBytes) || OUTLINE_MAX_BYTES)
  const maxEntries = Math.max(1, Number(options.maxEntries) || OUTLINE_MAX_ENTRIES)
  const entries = []
  let truncated = false
  let fd = null
  try {
    fd = fs.openSync(mdPath, 'r')
    const buf = Buffer.alloc(maxBytes)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    truncated = safeSize(mdPath) > n
    const text = buf.subarray(0, n).toString('utf8').replace(/\r\n?/g, '\n')
    let line = 1
    for (const raw of text.split('\n')) {
      if (entries.length >= maxEntries) break
      const m = raw.match(/^(#{1,4})\s+(.+?)\s*$/)
      if (m) entries.push({ level: m[1].length, line, title: m[2].slice(0, 120) })
      line++
    }
  } catch {
    /* an unreadable artifact simply has no outline */
  } finally {
    if (fd !== null) { try { fs.closeSync(fd) } catch { /* ignore */ } }
  }
  return { entries, truncated }
}

/**
 * What the model should actually do with an artifact of this size.
 *
 * Nothing is ever trimmed — the point of the whole plugin is to hand over the
 * complete document — so the honest alternative is to say how big it is and how
 * to read it without swallowing it whole.
 */
function readingStrategy(shownDst, bytes, tokens, lines) {
  const parts = [
    '请用 read 工具读取 ' + shownDst + '：先读前 ' + READ_LINE_HINT +
    ' 行看清结构（read 本身也只返回前 2000 行），再用 grep 在同一个文件里定位需要的片段，不要一次性把整份读进上下文。'
  ]
  if (lines > LOUD_ARTIFACT_LINES) {
    parts.push(
      '该产物约 ' + lines.toLocaleString('en-US') + ' 行、约 ' + tokens.toLocaleString('en-US') +
      ' tokens（' + humanBytes(bytes) + '）：整份读入会明显挤占上下文，建议先用 action:"outline" 拿章节 / 工作表索引，再定点读取。'
    )
  }
  return parts.join(' ')
}

function pushOutline(lines, value) {
  if (!value.outline || !value.outline.length) return
  lines.push('• 结构索引（' + (value.outlineTruncated ? '只看了解文件开头，' : '') +
    '共 ' + value.outline.length + ' 个标题，行号为约值）：')
  for (const h of value.outline) {
    lines.push('    ' + '　'.repeat(Math.max(0, h.level - 1)) + h.title + '（约第 ' + h.line + ' 行）')
  }
}

function pushPreview(lines, value) {
  if (!value.preview) return
  lines.push('')
  lines.push('--- 预览（前 ' + value.preview.length + ' 字符）---')
  lines.push(value.preview)
  if (value.previewTruncated) lines.push('…（预览已截断）')
}

/**
 * The artifact the current cache key points at, or — when the source has moved
 * on — the newest artifact that still exists, flagged `stale`.
 *
 * `action:"read"` on a file whose mtime changed used to be a dead end: the key
 * missed, the tool answered "还没有转换结果，请先执行转换", and the already
 * converted `.md` sitting right next to it was ignored. Handing back the newest
 * artifact with an honest `stale` flag turns that into a useful answer.
 */
function findExistingArtifact(cfg, absSrc, st, root) {
  const target = conversionTarget(cfg, absSrc, st, root)
  if (fs.existsSync(target.absDst) && safeSize(target.absDst) > 0) return { ...target, stale: false }
  const latest = findLatestArtifact(absSrc, tmpDirFor(cfg, absSrc, root))
  if (!latest) return null
  return { absDst: latest.path, shownDst: displayPath(latest.path, root), stale: true }
}

/**
 * Reuse an artifact that was really produced from *this* source content.
 *
 * The cache key ends in the source's mtime, which `git checkout`, a copy or a
 * restore changes without touching a single byte — so a naive lookup writes a
 * second, identical `.md` next to the first. Every artifact records the size
 * and a content hash of the source it came from, so a moved mtime is checked
 * against the real content before paying for a re-conversion.
 *
 * On a hit the artifact is renamed onto the current key, so the fast path hits
 * again next time and one source keeps exactly one artifact.
 */
function reuseByContent(cfg, absSrc, st, root) {
  const candidates = listArtifacts(absSrc, tmpDirFor(cfg, absSrc, root))
  if (!candidates.length) return null
  const comparable = []
  for (const art of candidates) {
    const stamp = readFidelityMarker(art.path)
    if (!stamp || !stamp.srchash || stamp.srchash === 'unknown') continue
    if (String(stamp.srcbytes) !== String(st.size)) continue
    /* Never trade a MarkItDown artifact for a fallback one: if the only match
     * is limited fidelity, converting fresh is the better answer. */
    if (stamp.fidelity === 'limited') continue
    comparable.push(art)
  }
  if (!comparable.length) return null
  const hash = sourceContentHash(absSrc)
  if (!hash) return null
  for (const art of comparable) {
    const stamp = readFidelityMarker(art.path)
    if (!stamp || stamp.srchash !== hash) continue
    const target = conversionTarget(cfg, absSrc, st, root)
    let absDst = art.path
    try {
      fs.renameSync(art.path, target.absDst)
      absDst = target.absDst
    } catch { /* keep the old name if it cannot be renamed */ }
    return {
      absDst,
      shownDst: displayPath(absDst, root),
      converter: stamp.converter,
      fidelity: stamp.fidelity
    }
  }
  return null
}

/** Every artifact of this source except the one the current key points at. */
function staleArtifactsFor(cfg, absSrc, st, root) {
  const dir = tmpDirFor(cfg, absSrc, root)
  const current = path.resolve(conversionTarget(cfg, absSrc, st, root).absDst)
  const stale = listArtifacts(absSrc, dir).filter((art) => path.resolve(art.path) !== current)
  return { dir, current, stale }
}

/**
 * Delete artifacts of one source the current key no longer points at.
 *
 * The blast radius is deliberately tiny: one directory, names matching this
 * plugin's own `<stem>-<8hex>.md` pattern, regular files only, never recursive,
 * and never the artifact the current key resolves to. Anything else in the
 * folder — including a `.md` the user wrote by hand — is untouched.
 */
function pruneArtifactsFor(cfg, absSrc, st, root, keepAbs) {
  const keep = keepAbs ? path.resolve(keepAbs) : ''
  const removed = []
  const failed = []
  for (const art of staleArtifactsFor(cfg, absSrc, st, root).stale) {
    if (keep && path.resolve(art.path) === keep) continue
    try {
      fs.rmSync(art.path, { force: true })
      removed.push(art)
    } catch (error) {
      failed.push({ path: art.path, error: String((error && error.message) || error) })
    }
  }
  return { removed, failed }
}

/** `path` / `paths` normalised into the raw inputs the caller asked for. */
function requestedPaths(args) {
  const out = []
  const push = (value) => {
    if (typeof value !== 'string') return
    for (const part of value.split(/\r?\n/)) {
      const trimmed = part.trim()
      if (trimmed) out.push(trimmed)
    }
  }
  push(args.path)
  const list = Array.isArray(args.paths) ? args.paths : (Array.isArray(args.path) ? args.path : [])
  for (const item of list) push(item)
  return out
}

/**
 * Turn one raw input into the concrete files to process.
 *
 * A directory expands to the Office/PDF files inside it (`recursive` walks
 * deeper), because "convert every workbook in this folder" is one intent, not N
 * round trips. The cap keeps a stray `path:"."` from turning into an unbounded
 * walk over a whole repository.
 */
function expandInput(rawPath, root, recursive) {
  const abs = resolveInputPath(rawPath, root)
  let st = null
  try { st = fs.statSync(abs) } catch { st = null }
  if (!st) {
    return {
      error: fail('文件不存在：' + abs, {
        sourcePath: rawPath,
        fallbackHint: '请确认路径是否正确（相对路径以工作区 ' + (root || process.cwd()) + ' 为基准）。'
      })
    }
  }
  if (st.isFile()) return { files: [{ abs, st }] }
  if (!st.isDirectory()) return { error: fail('不是文件也不是目录：' + abs, { sourcePath: rawPath }) }

  const files = []
  /* Counted so the answer can say what the walk actually did: a directory that
   * yields a single workbook must not read as "this folder holds one file",
   * and a silently skipped .txt must not look like it was never there. */
  let scanned = 0
  let skipped = 0
  let subdirs = 0
  const walk = (dir, depth) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (files.length >= MAX_EXPAND_FILES) return
      const child = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (recursive && depth < 8) walk(child, depth + 1)
        else subdirs++          // left unvisited: not recursive, or too deep
        continue
      }
      if (!entry.isFile()) continue
      scanned++
      if (classify(child).kind !== 'office') { skipped++; continue }
      try { files.push({ abs: child, st: fs.statSync(child) }) } catch { /* ignore */ }
    }
  }
  walk(abs, 0)
  return {
    files,
    directory: abs,
    capped: files.length >= MAX_EXPAND_FILES,
    scanned,
    skipped,
    subdirs
  }
}

function buildDefinition(ctx, cfg) {
  return defineTool({
    name: TOOL_NAME,
    description:
      '把工作区里的 Office / PDF 文件（.docx、.xlsx、.pptx、.pdf、.xls、.odt、.epub 等）先用 MarkItDown 转成 Markdown，' +
      '把结果写成源文件旁边的 .md，只返回该 .md 的路径、体积、行数、token 估算和标题结构索引，**不把全文塞进上下文**；随后用 read 工具按需读取该 .md。' +
      '产物不会被裁剪，读取方式建议：先读前 200 行看结构，再用 grep 在同一个 .md 里定位需要的片段。' +
      '一次可以处理多个文件或整个目录（用 paths，或直接把目录路径交给 path），也可以用 action:"outline" 只看已有结果的结构索引（不触发转换）。' +
      '纯文本 / Markdown / CSV 文件本来就能直接读取，本工具会直接告知，不需要转换。' +
      '转换在本地完成，不改动原文件。当模型需要读取 .docx/.xlsx/.pptx/.pdf 等文件时必须先调用本工具。',
    parameters: {
      path: {
        type: 'string',
        description: '要处理的文件或目录路径（相对工作区或绝对路径）。传目录时按扩展名找出其中的 Office/PDF 文件。action 为 "status" 时可省略'
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: '批量处理：多个文件或目录路径（等价于把数组交给 path）。一次调用处理多个文件，省掉逐文件来回'
      },
      action: {
        type: 'string',
        description:
          "动作：'auto'（默认，自动判断类型并转换或提示直接读取）、'convert'（强制转换）、'read'（读取已转换结果的开头）、'outline'（只给已转换结果的结构索引，绝不触发转换）、'clean'（清理同一源文件的陈旧产物）、'status'（查看当前可用的转换器与 Python 环境）"
      },
      force: {
        type: 'boolean',
        description: 'true 时忽略已有转换结果，重新转换'
      },
      preview: {
        type: 'number',
        description: '可选：返回转换后 Markdown 开头的字符数（默认 0 = 只返回路径，最省 token；上限为配置的 maxPreviewChars）'
      },
      recursive: {
        type: 'boolean',
        description: 'path 是目录时是否递归子目录（默认 false）；无论是否递归，一次最多展开 200 个文件'
      },
      dryRun: {
        type: 'boolean',
        description: "仅对 action:'clean' 有效：true（默认）只报告将删除哪些陈旧产物，传 false 才真的删除"
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
  if (value.status === 'clean') {
    const lines = [(value.dryRun ? '🧹 陈旧产物检查（没有删除任何文件）' : '🧹 已清理陈旧产物') + '：' + value.sourcePath]
    lines.push('• 目录：' + value.directory)
    if (value.markdownPath) lines.push('• 保留（当前源文件对应的产物）：' + value.markdownPath)
    if (!value.staleCount) {
      lines.push('• 没有需要清理的陈旧产物。')
    } else {
      lines.push('• 陈旧产物 ' + value.staleCount + ' 个，共 ' + humanBytes(value.staleBytes) + '：')
      for (const item of value.stale) lines.push('    ' + item.path + '（' + humanBytes(item.size) + '）')
    }
    for (const item of value.failed || []) lines.push('• 删除失败：' + item.path + '（' + item.error + '）')
    for (const note of value.notices || []) lines.push('• 提示：' + note)
    lines.push('下一步：' + value.guidance)
    return lines.join('\n')
  }
  if (value.status === 'outline') {
    const lines = ['🗂 结构索引：' + value.sourcePath]
    lines.push('• Markdown：' + value.markdownPath + '（' + humanBytes(value.markdownBytes) + '，约 ' +
      (value.lineCount || 0).toLocaleString('en-US') + ' 行，约 ' + (value.estimatedTokens || 0).toLocaleString('en-US') + ' tokens）')
    lines.push('• 转换器：' + (value.converterLabel || '未知') + '（保真度：' + fidelityWord(value.fidelity) + '）')
    for (const note of value.notices || []) lines.push('• 提示：' + note)
    if (value.outline && value.outline.length) pushOutline(lines, value)
    else lines.push('• 没有可用的标题索引。')
    lines.push('下一步：' + value.guidance)
    return lines.join('\n')
  }
  if (value.status === 'read') {
    const lines = ['📖 已有转换结果：' + value.sourcePath]
    lines.push('• Markdown：' + value.markdownPath + '（' + humanBytes(value.markdownBytes) + '，约 ' +
      (value.lineCount || 0).toLocaleString('en-US') + ' 行，约 ' + (value.estimatedTokens || 0).toLocaleString('en-US') + ' tokens）')
    lines.push('• 转换器：' + (value.converterLabel || '未知') + '（保真度：' + fidelityWord(value.fidelity) + '）')
    for (const note of value.notices || []) lines.push('• 提示：' + note)
    pushOutline(lines, value)
    lines.push('下一步：' + value.guidance)
    pushPreview(lines, value)
    return lines.join('\n')
  }
  if (value.status === 'batch') {
    const lines = ['📚 批量处理 ' + value.total + ' 个文件（成功 ' + value.succeeded + '，失败 ' + value.failed + '）：' + value.sourcePath]
    for (const item of value.results || []) {
      if (!item.ok) {
        lines.push('  ✗ ' + item.sourcePath + ' —— ' + item.error)
      } else if (item.direct) {
        lines.push('  • ' + item.sourcePath + '（' + (item.note || '纯文本') + '，直接用 read 读取即可，无需转换）')
      } else {
        lines.push('  ✓ ' + item.sourcePath + ' → ' + item.markdownPath + '（' + humanBytes(item.markdownBytes) +
          '，约 ' + (item.estimatedTokens || 0).toLocaleString('en-US') + ' tokens，' + (item.converterLabel || item.converter || '') + '）')
      }
    }
    for (const note of value.notices || []) lines.push('• 提示：' + note)
    lines.push('下一步：' + value.guidance)
    return lines.join('\n')
  }
  if (value.status === 'direct-read') {
    const lines = ['📄 ' + value.sourcePath + ' 是 ' + (value.sourceKind || '纯文本') + '，可以直接读取，无需转换。']
    for (const note of value.notices || []) lines.push('• 提示：' + note)
    lines.push(value.guidance)
    return lines.filter(Boolean).join('\n')
  }
  const lines = []
  lines.push((value.cached ? '♻️ 已有转换结果' : '✅ 已转换为 Markdown') + '：' + value.sourcePath)
  lines.push('• 源文件：' + value.sourcePath + '（' + humanBytes(value.sourceBytes) + '，未修改）')
  lines.push(
    '• Markdown：' + value.markdownPath + '（' + humanBytes(value.markdownBytes) +
    (value.lineCount ? '，约 ' + value.lineCount.toLocaleString('en-US') + ' 行' : '') +
    '，约 ' + (value.estimatedTokens || 0).toLocaleString('en-US') + ' tokens）'
  )
  lines.push('• 转换器：' + (value.converterLabel || value.converter) + '（保真度：' + fidelityWord(value.fidelity) + '）')
  if (value.converterNote) lines.push('• 说明：' + value.converterNote)
  for (const note of value.notices || []) lines.push('• 提示：' + note)
  pushOutline(lines, value)
  lines.push('下一步：' + value.guidance)
  pushPreview(lines, value)
  return lines.join('\n')
}

function fail(message, extra = {}) {
  return { ok: false, error: message, ...extra }
}

/**
 * Convert / read / outline ONE source file.
 *
 * Split out of `executeTool` so a directory or a `paths` list can run the same
 * logic per file. Files are handled one at a time on purpose: conversion is CPU-
 * and disk-heavy, and a serial loop keeps a 50-file folder from spawning 50
 * interpreters at once.
 */
async function executeOne(ctx, cfg, args, action, absSrc, st, root, exec, logger) {
  const signal = exec && exec.signal ? exec.signal : undefined
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

  if (action === 'outline') {
    const existing = findExistingArtifact(cfg, absSrc, st, root)
    if (!existing) {
      return fail('还没有转换结果，无法给出结构索引。请先转换（action:"convert" 或不传 action）。', { sourcePath: shownSrc })
    }
    return outlineValue(existing, shownSrc)
  }

  if (action === 'read') {
    const existing = findExistingArtifact(cfg, absSrc, st, root)
    if (!existing) {
      return fail('还没有转换结果，请先执行转换（action:"convert" 或不传 action）。', { sourcePath: shownSrc })
    }
    return readExisting(cfg, existing, shownSrc, args)
  }

  // convert / auto on Office or unknown-binary files
  ensureTmpDir(ctx, cfg, absSrc, root)
  const target = conversionTarget(cfg, absSrc, st, root)
  const hasTarget = cfg.reuseFresh !== false && fs.existsSync(target.absDst) && safeSize(target.absDst) > 0
  const startedAt = Date.now()
  const notices = []
  let activeTarget = target
  let result = null

  if (hasTarget && !args.force) {
    const stamp = readFidelityMarker(target.absDst)
    if (!stamp) {
      /* Written by 1.1.x, before artifacts recorded how they were made. Reusing
       * it is still right; claiming "high" fidelity for it is not. */
      result = {
        ok: true,
        converter: 'cache',
        converterLabel: '已有转换结果（旧版本写入，未记录转换器）',
        fidelity: 'unknown',
        converterNote: null,
        probeNotes: []
      }
    } else if (stamp.fidelity === 'limited') {
      /* A fallback converter produced this. MarkItDown may have been installed
       * since — exactly the case where reusing the cache silently downgrades
       * the answer — so consult the TTL-cached probe and re-convert only when a
       * high-fidelity converter has actually appeared. */
      let best = null
      try {
        best = ((await probeConverters(cfg, { signal })).chain || [])[0] || null
      } catch { /* probing must never block a reuse */ }
      if (best && best.fidelity === 'high') {
        notices.push('检测到可用的 MarkItDown（' + best.label + '），已重新转换以提升保真度。')
      } else {
        result = {
          ok: true,
          converter: 'cache',
          converterLabel: converterLabelFor(stamp.converter, '已有转换结果'),
          fidelity: stamp.fidelity,
          converterNote: null,
          probeNotes: []
        }
      }
    } else {
      result = {
        ok: true,
        converter: 'cache',
        converterLabel: converterLabelFor(stamp.converter, '已有转换结果'),
        fidelity: stamp.fidelity,
        converterNote: null,
        probeNotes: []
      }
    }
  }

  if (!result && !hasTarget && !args.force) {
    /* The mtime moved, but the bytes may not have (git checkout, a copy, a
     * restore). Reuse the existing artifact and re-key it rather than writing a
     * second identical .md next to the first. */
    const reused = reuseByContent(cfg, absSrc, st, root)
    if (reused) {
      activeTarget = { absDst: reused.absDst, shownDst: reused.shownDst }
      result = {
        ok: true,
        converter: 'cache',
        converterLabel: converterLabelFor(reused.converter, '已有转换结果'),
        fidelity: reused.fidelity || 'high',
        converterNote: null,
        probeNotes: []
      }
      notices.push('源文件的修改时间变了，但内容没有变（已比对内容哈希），直接复用已有 .md，没有生成重复文件。')
    }
  }

  if (!result) {
    result = await convertFile({ srcPath: absSrc, dstPath: target.absDst, cfg, signal, force: !!args.force })
    if (result.ok && cfg.pruneStaleArtifacts === true) {
      const pruned = pruneArtifactsFor(cfg, absSrc, st, root, target.absDst)
      if (pruned.removed.length) {
        notices.push('已按 pruneStaleArtifacts 清理同一源文件的 ' + pruned.removed.length + ' 个陈旧产物。')
      }
    }
  }

  if (!result.ok) {
    safeLog(logger, 'warn', '转换失败 ' + shownSrc + '：' + String(result.error || '未知错误').split('\n')[0].slice(0, 200))
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

  /* The artifact is never pulled into one string any more: `preview:0` used to
   * read the whole Markdown into memory just to report its size and token
   * count, on the default path, for a value it then declined to return. */
  const previewLimit = Math.max(0, Math.min(Number(args.preview) || 0, cfg.maxPreviewChars || 4000))
  const info = analyzeMarkdown(activeTarget.absDst, { headChars: previewLimit + 1 })
  const previewTruncated = previewLimit > 0 && info.head.length > previewLimit
  const preview = previewLimit > 0 ? info.head.slice(0, previewLimit) : ''
  const outline = buildOutline(activeTarget.absDst)

  if (result.converter === 'cache' && notices.length === 0) {
    notices.push('命中缓存：源文件未变化，直接复用已有 .md（如需强制重转请传 force:true）。')
  }
  if (cls.kind === 'unknown') notices.push('无法从扩展名判断类型，已按二进制处理。')
  if (result.fidelity === 'limited') notices.push('未使用 MarkItDown，保真度有限（见上方说明）。')
  if (result.fidelity === 'unknown') notices.push('这个 .md 由旧版本插件生成，没有记录转换器与保真度；需要确认时传 force:true 重新转换。')

  safeLog(
    logger,
    'info',
    (result.converter === 'cache' ? '复用已有转换结果 ' : '转换成功 ') + shownSrc + ' → ' + activeTarget.shownDst +
    '（' + (result.converter === 'cache'
      ? '未重新转换'
      : String(result.converter) + '，' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's') +
    '，' + humanBytes(info.bytes) + '，约 ' + info.lines.toLocaleString('en-US') + ' 行）'
  )

  return {
    ok: true,
    status: result.converter === 'cache' ? 'cached' : 'converted',
    cached: result.converter === 'cache',
    sourcePath: shownSrc,
    sourceAbsolutePath: absSrc,
    sourceBytes: st.size,
    sourceKind: cls.label,
    markdownPath: activeTarget.shownDst,
    markdownAbsolutePath: activeTarget.absDst,
    markdownBytes: info.bytes,
    lineCount: info.lines,
    estimatedTokens: info.tokens,
    converter: result.converter,
    converterLabel: result.converterLabel,
    fidelity: result.fidelity,
    converterNote: result.converterNote,
    outline: outline.entries,
    outlineTruncated: outline.truncated,
    preview: preview || undefined,
    previewTruncated,
    notices,
    guidance: readingStrategy(activeTarget.shownDst, info.bytes, info.tokens, info.lines)
  }
}

async function executeTool(ctx, cfg, args, exec) {
  const logger = loggerFor(ctx)
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

  const raws = requestedPaths(args)
  if (!raws.length) {
    return fail('缺少 path 参数。用法：read_office_as_markdown({ path: "报表.xlsx" })；批量时用 paths: ["a.xlsx", "b.docx"]，或直接传一个目录。')
  }

  if (action === 'clean') {
    if (raws.length > 1) return fail('action:"clean" 一次只处理一个源文件，请分开调用。', { sourcePath: raws[0] })
    const raw = raws[0]
    const abs = resolveInputPath(raw, root)
    let st = null
    try { st = fs.statSync(abs) } catch { st = null }
    if (!st) {
      return fail('文件不存在：' + abs, {
        sourcePath: raw,
        fallbackHint: '请确认路径是否正确（相对路径以工作区 ' + (root || process.cwd()) + ' 为基准）。'
      })
    }
    if (!st.isFile()) return fail('不是文件（可能是目录）：' + abs, { sourcePath: raw })

    const shown = displayPath(abs, root)
    const dryRun = args.dryRun !== false
    const { dir, current, stale } = staleArtifactsFor(cfg, abs, st, root)
    const kept = fs.existsSync(current) && safeSize(current) > 0
    const outcome = dryRun ? { removed: [], failed: [] } : pruneArtifactsFor(cfg, abs, st, root, '')
    const staleBytes = stale.reduce((total, art) => total + art.size, 0)
    if (!dryRun && outcome.removed.length) {
      safeLog(logger, 'info', '清理陈旧产物 ' + shown + '：删除 ' + outcome.removed.length + ' 个，共 ' + humanBytes(staleBytes) + '。')
    }
    return {
      ok: true,
      status: 'clean',
      dryRun,
      sourcePath: shown,
      sourceAbsolutePath: abs,
      directory: displayPath(dir, root),
      markdownPath: kept ? displayPath(current, root) : '',
      staleCount: stale.length,
      staleBytes,
      stale: stale.map((art) => ({ path: displayPath(art.path, root), size: art.size })),
      removed: outcome.removed.map((art) => displayPath(art.path, root)),
      failed: outcome.failed.map((item) => ({ path: displayPath(item.path, root), error: item.error })),
      notices: kept ? [] : ['当前源文件对应的产物还不存在，下面列出的都是源文件变化前留下的旧版本。'],
      guidance: stale.length
        ? (dryRun ? '确认无误后，再调用一次并传 dryRun:false 才会真正删除。' : '已删除上面列出的文件。')
        : '没有需要清理的产物。'
    }
  }

  const recursive = args.recursive === true
  const files = []
  let directory = ''
  let capped = false
  const dirStats = { dirs: 0, picked: 0, scanned: 0, skipped: 0, subdirs: 0 }
  for (const raw of raws) {
    const expanded = expandInput(raw, root, recursive)
    if (expanded.error) {
      if (raws.length === 1) return expanded.error
      files.push({ error: expanded.error, raw })
      continue
    }
    if (expanded.directory) {
      directory = expanded.directory
      dirStats.dirs++
      dirStats.picked += expanded.files.length
      dirStats.scanned += expanded.scanned || 0
      dirStats.skipped += expanded.skipped || 0
      dirStats.subdirs += expanded.subdirs || 0
    }
    if (expanded.capped) capped = true
    for (const item of expanded.files) files.push(item)
  }

  /* What the directory walk decided, stated out loud. Without this the caller
   * only sees "1 file" and cannot tell a folder with one workbook from a folder
   * with one workbook and nine spreadsheets it declined to touch. */
  const dirNotices = []
  if (dirStats.dirs) {
    const parts = ['目录展开：' + (recursive ? '已递归子目录' : '默认不递归子目录')]
    if (!recursive && dirStats.subdirs) {
      parts.push('跳过 ' + dirStats.subdirs + ' 个子目录（需要就传 recursive:true）')
    }
    parts.push('扫到 ' + dirStats.scanned + ' 个文件，挑出 ' + dirStats.picked + ' 个 Office / PDF')
    if (dirStats.skipped) parts.push('另有 ' + dirStats.skipped + ' 个非 Office / PDF 文件已跳过')
    parts.push('上限 ' + MAX_EXPAND_FILES + ' 个')
    dirNotices.push(parts.join('；') + '。')
  }

  if (!files.length) {
    if (directory) {
      return fail(
        '这个目录里没有可转换的 Office / PDF 文件：' + displayPath(directory, root) +
        (recursive ? '' : '（默认不递归子目录，需要的话传 recursive:true）'),
        { sourcePath: displayPath(directory, root) }
      )
    }
    return fail('没有可处理的文件。', { sourcePath: raws.join(', ') })
  }

  /* One file keeps the full, detailed answer. A batch gets one compact line per
   * file, because twelve weekly reports should not cost twelve turns. */
  if (files.length === 1) {
    const value = await executeOne(ctx, cfg, args, action, files[0].abs, files[0].st, root, exec, logger)
    if (!dirNotices.length || !value || typeof value !== 'object') return value
    return { ...value, notices: [...(value.notices || []), ...dirNotices] }
  }

  const results = []
  for (const item of files) {
    if (item.error) {
      results.push({ ok: false, sourcePath: item.raw, error: item.error.error })
      continue
    }
    const value = await executeOne(ctx, cfg, args, action, item.abs, item.st, root, exec, logger)
    if (!value.ok) {
      results.push({ ok: false, sourcePath: value.sourcePath || item.abs, error: value.error })
      continue
    }
    if (value.status === 'direct-read') {
      results.push({ ok: true, direct: true, sourcePath: value.sourcePath, note: value.sourceKind || '纯文本' })
      continue
    }
    results.push({
      ok: true,
      sourcePath: value.sourcePath,
      markdownPath: value.markdownPath,
      markdownBytes: value.markdownBytes,
      estimatedTokens: value.estimatedTokens,
      converter: value.converter,
      converterLabel: value.converterLabel,
      fidelity: value.fidelity,
      stale: value.stale === true
    })
  }

  const succeeded = results.filter((item) => item.ok).length
  const notices = []
  if (capped) {
    notices.push('目录展开达到上限（' + MAX_EXPAND_FILES + ' 个文件），只处理了前 ' + MAX_EXPAND_FILES + ' 个；其余请再调用一次或缩小范围。')
  }
  notices.push(...dirNotices)
  return {
    ok: true,
    status: 'batch',
    sourcePath: directory ? displayPath(directory, root) : raws.join(', '),
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
    notices,
    guidance: '每个文件都已在源文件旁边生成 .md，按需用 read / grep 逐个读取，不要一次性全部读入。'
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

function conversionTarget(cfg, absSrc, st, root) {
  const dir = tmpDirFor(cfg, absSrc, root)
  const hash = sha8(absSrc + '|' + st.size + '|' + st.mtimeMs + '|' + configSignature(cfg))
  const absDst = path.join(dir, safeBaseName(absSrc) + '-' + hash + '.md')
  return { absDst, shownDst: displayPath(absDst, root) }
}

/** Outline-only answer: never converts, so it is safe on any turn. */
function outlineValue(existing, shownSrc) {
  const info = analyzeMarkdown(existing.absDst, { headChars: 0 })
  const outline = buildOutline(existing.absDst)
  const stamp = readFidelityMarker(existing.absDst)
  return {
    ok: true,
    status: 'outline',
    sourcePath: shownSrc,
    markdownPath: existing.shownDst,
    markdownAbsolutePath: existing.absDst,
    markdownBytes: info.bytes,
    lineCount: info.lines,
    estimatedTokens: info.tokens,
    converter: stamp ? stamp.converter : '',
    converterLabel: stamp ? converterLabelFor(stamp.converter, '已有转换结果') : '已有转换结果',
    fidelity: stamp && stamp.fidelity ? stamp.fidelity : 'unknown',
    stale: !!existing.stale,
    outline: outline.entries,
    outlineTruncated: outline.truncated,
    notices: existing.stale ? ['源文件已变化，这是较早的产物；要基于最新源文件重转，请传 force:true。'] : [],
    guidance: outline.entries.length
      ? '按上面的标题挑需要的章节，用 grep 在该 .md 里定位后定点 read，不要整份读入。'
      : '这个产物没有 Markdown 标题可作索引；请用 grep 在该 .md 里搜索关键词，再定点 read。'
  }
}

/**
 * Read the head of an existing artifact.
 *
 * The preview cap is `cfg.maxPreviewChars` — the same knob the conversion path
 * honours — instead of a second, hard-coded 4000 that quietly ignored config.
 */
function readExisting(cfg, target, shownSrc, args) {
  const limit = Math.max(0, Math.min(Number(args.preview) || 2000, cfg.maxPreviewChars || 4000))
  const info = analyzeMarkdown(target.absDst, { headChars: limit + 1 })
  const truncated = info.head.length > limit
  const head = truncated ? info.head.slice(0, limit) : info.head
  const stamp = readFidelityMarker(target.absDst)
  const outline = buildOutline(target.absDst)
  const notices = []
  if (target.stale) notices.push('源文件已变化，这是较早的产物；要基于最新源文件重转，请传 force:true。')
  if (!stamp) notices.push('这个 .md 由旧版本插件生成，没有记录转换器与保真度。')
  return {
    ok: true,
    status: 'read',
    cached: true,
    sourcePath: shownSrc,
    markdownPath: target.shownDst,
    markdownAbsolutePath: target.absDst,
    markdownBytes: info.bytes,
    lineCount: info.lines,
    estimatedTokens: info.tokens,
    converter: stamp ? stamp.converter : '',
    converterLabel: stamp ? converterLabelFor(stamp.converter, '已有转换结果') : '已有转换结果',
    fidelity: stamp && stamp.fidelity ? stamp.fidelity : 'unknown',
    stale: !!target.stale,
    outline: outline.entries,
    outlineTruncated: outline.truncated,
    notices,
    preview: head || undefined,
    previewTruncated: truncated,
    guidance: '如需完整内容，请用 read 工具分段读取 ' + target.shownDst + '（先读前 200 行看结构，再 grep 定位）。'
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
  const root = profilesRoot()
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
 * 卸载后清环境：这里**不能**用宿主内的定时器轮询。
 *
 * `dsh-plugin-manager` 的 `removeBundle()` 是 `selectBundle(false)` →
 * `reload()` → `pnpm remove`（见 @deepseek-ai/dsh-plugin-manager/lib/index.js
 * :1844-1863）：本插件的 fiber 先被销毁，几秒后包目录才被删掉。宿主内的定时
 * 器一旦遇到用户顺手重启一次 harness 就全部消失，环境便永远清不掉了。
 *
 * 因此这里派一个脱离宿主的看门狗进程（`lib/removal-watchdog.js`）去做：它自己
 * 轮询，确认插件真的被移除后才卸载登记的 Python 包。
 *
 * 但派发本身也要克制：这个函数在**每一次 dispose** 时都会被调用，而关闭插件、
 * 重载 profile、退出 DSH 同样会 dispose。所以下面先用 `stillSelectedInProfile()`
 * 判断「profile 是不是已经不要本插件了」——只有真正的卸载会命中，平时连一个
 * 后台进程都不会起。
 */
/**
 * True while some profile still lists this plugin among the bundles it wants.
 *
 * `dsh-plugin-manager.removeBundle()` runs `selectBundle(name, false)` *before*
 * `reload()` (index.js:1844-1863), so at dispose time a real removal has
 * already dropped us from `dsh.profile.bundles` while an ordinary shutdown, a
 * profile reload or a plain disable still has us there. That makes this a cheap
 * "is somebody actually removing me?" test — and it is what keeps the watchdog
 * from ever being spawned during normal use.
 */
function stillSelectedInProfile() {
  const candidates = []
  const current = currentProfileDir()
  if (current !== '') {
    candidates.push(path.join(current, 'package.json'))
  } else {
    let names = []
    try {
      names = fs.readdirSync(profilesRoot())
    } catch {
      return true // 读不到 profiles 就当作「仍在启用」，宁可什么都不做
    }
    for (const profile of names) candidates.push(path.join(profilesRoot(), profile, 'package.json'))
  }
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      const profileSection = manifest && manifest.dsh ? manifest.dsh.profile : null
      const bundles = profileSection ? profileSection.bundles : null
      if (Array.isArray(bundles) && bundles.includes(PROVIDER)) return true
    } catch { /* 单个 profile 解析失败不影响其它 profile */ }
  }
  return false
}

function scheduleRemovalCleanup(cfg, logger) {
  if (cfg && cfg.removeEnvOnUninstall === false) return
  const snap = readSnapshot()
  if (!snap) return
  const packages = Array.isArray(snap.added)
    ? snap.added.filter((item) => typeof item === 'string' && item !== '')
    : []
  if (packages.length === 0) return

  let gone = false
  try {
    gone = removalConfirmed()
  } catch {
    gone = false
  }
  if (gone) {
    void runEnvRemoval(cfg, logger)
    return
  }

  // Normal use must stay free of background processes: shutting DSH down,
  // reloading the profile or merely disabling the plugin all dispose us while
  // the profile still selects the bundle. Only a real removal has already
  // dropped us from `dsh.profile.bundles` by this point.
  let stillSelected = true
  try {
    stillSelected = stillSelectedInProfile()
  } catch {
    stillSelected = true
  }
  if (stillSelected) return

  if (!snap.python) {
    safeLog(
      logger,
      'warn',
      '环境记录里没有解释器路径，插件被卸载后不会自动清理；可在 profile 目录里跑 install.ps1 -Uninstall。'
    )
    return
  }

  try {
    const info = spawnRemovalWatchdog({
      packageRoot: PACKAGE_ROOT,
      profilesRoot: profilesRoot(),
      snapshotPath: snapshotPath(),
      lockPath: watchdogLockPath(),
      python: snap.python,
      packages,
      logPath: removalLogPath(),
      timeoutSec: 120
    })
    safeLog(
      logger,
      'info',
      '检测到本插件正被移除，已派发卸载看门狗（pid ' +
        info.pid +
        '）：确认插件真的被移除后，它会卸载登记的 ' +
        packages.length +
        ' 个 Python 包。'
    )
  } catch (error) {
    safeLog(logger, 'warn', '无法派发卸载看门狗：' + String((error && error.message) || error))
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

  // Learn where this host actually keeps its data before anything looks up a
  // path. `profileContext.dir` is the profile directory DSH itself reports, and
  // `<dsh home>/profiles/<name>` gives the DSH home back; `lib/paths.js` falls
  // back to `DSH_HOME` and then `~/.dsh` when the host says nothing.
  try {
    const profileContext = ctx.get('profileContext')
    const dir = profileContext && typeof profileContext.dir === 'string' ? profileContext.dir : ''
    setProfileDir(dir)
  } catch { /* keep the environment-variable and homedir fallbacks */ }

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
              '遇到 .docx、.xlsx、.pptx、.pdf 等 Office / PDF 文件时，必须先调用 read_office_as_markdown 转成 Markdown 再读取：结果写在源文件旁边（工作区里），只把 .md 路径、体积与标题结构索引返回，避免全文注入上下文；产物完整保留、绝不裁剪，一次调用还能批量处理多个文件或整个目录。',
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
      () => tools.guard((execution) => guardRead(ctx, cfg, execution)),
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

/**
 * Best-effort artifact lookup for the read guard.
 *
 * The guard runs outside any tool call, so there is no session workspace to
 * resolve a relative path against. It is tried against the process working
 * directory and simply yields no hint when it does not land on a real file —
 * the guard message itself stays useful either way.
 */
function existingArtifactFor(cfg, raw) {
  try {
    const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw)
    const st = fs.statSync(abs)
    if (!st.isFile()) return null
    return findExistingArtifact(cfg, abs, st, undefined)
  } catch {
    return null
  }
}

function guardRead(ctx, cfg, execution) {
  try {
    if (!execution || execution.name !== 'read') return undefined
    const args = execution.arguments || {}
    const raw = args.file_path || args.path || args.filePath || args.filename
    if (typeof raw !== 'string' || !raw) return undefined
    const cls = classify(raw)
    if (cls.kind !== 'office') return undefined
    const shown = raw.replace(/\\/g, '/')

    /* If the file already HAS an artifact, answering "convert it first" is
     * simply wrong — the work is done, and the model is being told to redo it.
     * Hand over the .md path so the very next read succeeds. */
    const existing = existingArtifactFor(cfg, raw)
    if (existing) {
      return (
        '「' + shown + '」是 ' + cls.label + '（' + cls.ext + '），不能直接读取（二进制容器，读出来是乱码）。' +
        '但它已经转换好了' + (existing.stale ? '（较早的产物，源文件此后有过改动）' : '') + '：\n' +
        existing.absDst + '\n' +
        '请直接 read 上面这个 .md 文件。要基于最新源文件重新转换，调用 ' + TOOL_NAME +
        '({ path: "' + shown + '", force: true })。'
      )
    }

    return (
      '「' + shown + '」是 ' + cls.label + '（' + cls.ext + '），属于二进制压缩容器，直接读取会得到乱码并浪费 token。' +
      '请先调用 ' + TOOL_NAME + '({ path: "' + shown + '" }) 转换成 Markdown，再 read 生成的 .md 文件。' +
      '（这条拦截来自 office-markdown 插件，为的是不让二进制内容进上下文；换成别的路径读同一个文件并不能绕过它。确实需要直接读取原始字节时，请让用户把配置项 guardReadTool 设为 false。）'
    )
  } catch {
    return undefined
  }
}

export { SKILL_CONTENT, TOOL_NAME, SKILL_NAME, DEFAULTS }