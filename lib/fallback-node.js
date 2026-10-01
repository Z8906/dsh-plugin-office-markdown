/*!
 * dsh-plugin-office-markdown — 纯 Node 兜底转换器
 *
 * 不依赖 Python、不联网、不调用任何 API：用 Node 内置的 zlib 解开 OOXML
 * （.docx/.xlsx/.pptx 本质上是 zip + xml），再按 XML 结构抽取文字与表格，
 * 生成 Markdown。保真度有限（无版式/图表/批注/图片/公式/OCR），但保证在
 * “目标电脑既没有 Python 也没有网络”时仍能把文件读成 Markdown。
 *
 * 既可被 lib/convert.js 直接 import 调用，也可作为 CLI 使用：
 *   node fallback-node.js --input a.xlsx --output out.md
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'

export const NODE_SUPPORTED = new Set(['.docx', '.docm', '.xlsx', '.xlsm', '.pptx', '.pptm'])

const UNSUPPORTED = {
  '.pdf': 'Node 兜底不支持 PDF（PDF 需要 MarkItDown 或本机 Python 兜底）。',
  '.doc': '旧版二进制 .doc 需要 MarkItDown 转换，Node 兜底不支持。',
  '.xls': '旧版二进制 .xls 需要 MarkItDown 转换，Node 兜底不支持。',
  '.ppt': '旧版二进制 .ppt 需要 MarkItDown 转换，Node 兜底不支持。',
  '.msg': 'Outlook .msg 需要 MarkItDown 转换，Node 兜底不支持。',
  '.epub': 'EPUB 需要 MarkItDown 转换，Node 兜底不支持。',
  '.odt': 'ODF/OpenDocument 格式需要 MarkItDown 转换，Node 兜底不支持。',
  '.ods': 'ODF/OpenDocument 格式需要 MarkItDown 转换，Node 兜底不支持。',
  '.odp': 'ODF/OpenDocument 格式需要 MarkItDown 转换，Node 兜底不支持。'
}

/* ---------- zip ---------- */

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50

function readZip(file) {
  const buf = fs.readFileSync(file)
  let eocd = -1
  const floor = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('无法解析为 zip 容器（文件可能已损坏或不是真正的 OOXML 文件）')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== SIG_CENTRAL) break
    const method = buf.readUInt16LE(off + 10)
    const csize = buf.readUInt32LE(off + 20)
    const nlen = buf.readUInt16LE(off + 28)
    const elen = buf.readUInt16LE(off + 30)
    const clen = buf.readUInt16LE(off + 32)
    const lho = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nlen)
    entries.set(name, { method, csize, lho })
    off += 46 + nlen + elen + clen
  }
  return { buf, entries }
}

function readEntry(buf, entry) {
  const nlen = buf.readUInt16LE(entry.lho + 26)
  const elen = buf.readUInt16LE(entry.lho + 28)
  const start = entry.lho + 30 + nlen + elen
  const raw = buf.subarray(start, start + entry.csize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return zlib.inflateRawSync(raw)
  throw new Error('zip 压缩方式 ' + entry.method + ' 不受支持')
}

/* ---------- xml helpers ---------- */

function unescapeXml(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const TEXT_RE = /<(?:[A-Za-z0-9_]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g

function texts(xml) {
  let out = ''
  for (const m of String(xml).matchAll(TEXT_RE)) out += unescapeXml(m[1])
  return out
}

function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function mdTable(rows, opt) {
  if (!rows.length) return ''
  const width = Math.min(opt.maxTableCols, Math.max(...rows.map((r) => r.length)))
  if (width <= 0) return ''
  const lines = []
  const limit = Math.min(rows.length, opt.maxRowsPerSheet)
  for (let i = 0; i < limit; i++) {
    const cells = []
    for (let c = 0; c < width; c++) cells.push(rows[i][c] === undefined ? '' : cell(rows[i][c]))
    lines.push('| ' + cells.join(' | ') + ' |')
    if (i === 0) lines.push('| ' + cells.map(() => '---').join(' | ') + ' |')
  }
  if (rows.length > limit) lines.push('', `> 表格已截断：共 ${rows.length} 行，只显示前 ${limit} 行。`)
  return lines.join('\n')
}

/* ---------- docx ---------- */

function paraToMd(chunk) {
  const text = texts(chunk).replace(/\s+$/, '')
  if (!text.trim()) return ''
  const style = (chunk.match(/<w:pStyle[^>]*w:val="([^"]*)"/) || [])[1] || ''
  const heading = style.match(/^(?:Heading|heading|标题)\s*(\d+)$/)
  if (heading) return '#'.repeat(Math.min(6, Number(heading[1]) || 1)) + ' ' + text
  if (/^(?:Title|标题|Subtitle)$/i.test(style)) return '# ' + text
  if (/<w:numPr\b/.test(chunk)) return '- ' + text
  return text
}

function docxTableToMd(chunk, opt) {
  const rows = []
  for (const r of chunk.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
    const cells = []
    for (const c of r[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) cells.push(texts(c[1]))
    if (cells.length) rows.push(cells)
  }
  return mdTable(rows, opt)
}

function docxToMarkdown(buf, entries, opt) {
  const entry = entries.get('word/document.xml')
  if (!entry) throw new Error('缺少 word/document.xml，可能不是有效的 .docx')
  const xml = readEntry(buf, entry).toString('utf8')
  const blockRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
  const parts = []
  for (const m of xml.matchAll(blockRe)) {
    const chunk = m[0]
    const piece = chunk.startsWith('<w:tbl') ? docxTableToMd(chunk, opt) : paraToMd(chunk)
    if (piece && piece.trim()) parts.push(piece)
  }
  return parts.join('\n\n')
}

/* ---------- xlsx ---------- */

function colIndex(ref) {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

function sheetOrder(buf, entries) {
  const rels = {}
  const relEntry = entries.get('xl/_rels/workbook.xml.rels')
  if (relEntry) {
    const xml = readEntry(buf, relEntry).toString('utf8')
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = (m[0].match(/Id="([^"]*)"/) || [])[1]
      const target = (m[0].match(/Target="([^"]*)"/) || [])[1]
      if (id && target) rels[id] = target.replace(/^\/?xl\//, '').replace(/^\.\//, '')
    }
  }
  const out = []
  const wbEntry = entries.get('xl/workbook.xml')
  if (wbEntry) {
    const xml = readEntry(buf, wbEntry).toString('utf8')
    for (const m of xml.matchAll(/<sheet\b[^>]*>/g)) {
      const name = (m[0].match(/name="([^"]*)"/) || [])[1] || ''
      const rid = (m[0].match(/r:id="([^"]*)"/) || [])[1] || ''
      const target = rels[rid]
      if (target) out.push({ name: unescapeXml(name), target: 'xl/' + target })
    }
  }
  if (!out.length) {
    const names = [...entries.keys()]
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]))
    names.forEach((n, i) => out.push({ name: 'Sheet' + (i + 1), target: n }))
  }
  return out
}

function xlsxToMarkdown(buf, entries, opt) {
  const shared = []
  const sharedEntry = entries.get('xl/sharedStrings.xml')
  if (sharedEntry) {
    const xml = readEntry(buf, sharedEntry).toString('utf8')
    for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]))
  }
  const parts = []
  let budget = opt.maxCellsPerSheet
  for (const sheet of sheetOrder(buf, entries)) {
    const entry = entries.get(sheet.target)
    if (!entry) continue
    const xml = readEntry(buf, entry).toString('utf8')
    const rows = []
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= opt.maxRowsPerSheet || budget <= 0) break
      const arr = []
      for (const c of r[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
        const attrs = c[1] || c[3] || ''
        const inner = c[2] || ''
        const type = (attrs.match(/t="([^"]*)"/) || [])[1] || ''
        const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1] || ''
        let value = ''
        if (type === 's') {
          const idx = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
          value = shared[Number(idx)] !== undefined ? shared[Number(idx)] : ''
        } else if (type === 'inlineStr') {
          value = texts(inner)
        } else {
          const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
          value = v === undefined ? '' : unescapeXml(v)
        }
        const at = ref ? colIndex(ref) : arr.length
        if (at < 0) continue
        while (arr.length < at) arr.push('')
        arr[at] = value
        budget--
        if (budget <= 0) break
      }
      if (arr.length) rows.push(arr)
    }
    if (!rows.length) continue
    const table = mdTable(rows, opt)
    if (table) parts.push('## ' + (sheet.name || 'Sheet') + '\n\n' + table)
  }
  if (!parts.length) throw new Error('工作簿里没有可提取的单元格文本')
  return parts.join('\n\n')
}

/* ---------- pptx ---------- */

function pptxToMarkdown(buf, entries) {
  const names = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]))
  const parts = []
  names.forEach((n, i) => {
    const xml = readEntry(buf, entries.get(n)).toString('utf8')
    const lines = []
    for (const m of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
      const t = texts(m[1]).trim()
      if (t) lines.push(t)
    }
    if (!lines.length) return
    const body = lines.slice(1).map((l) => '- ' + l).join('\n')
    parts.push(`## 幻灯片 ${i + 1}：${lines[0]}` + (body ? '\n\n' + body : ''))
  })
  if (!parts.length) throw new Error('演示文稿里没有可提取的文本')
  return parts.join('\n\n')
}

/* ---------- entry ---------- */

export const NODE_DEFAULTS = Object.freeze({
  maxRowsPerSheet: 400,
  maxTableCols: 24,
  maxCellsPerSheet: 20000
})

/**
 * 把 srcPath 指向的 OOXML 文件转成 Markdown 写入 dstPath（纯本地、无依赖）。
 * @returns {{bytes:number, chars:number}}
 */
export function convertFileNode(srcPath, dstPath, options = {}) {
  const opt = { ...NODE_DEFAULTS, ...options }
  const ext = path.extname(srcPath).toLowerCase()
  if (!NODE_SUPPORTED.has(ext)) {
    throw new Error(UNSUPPORTED[ext] || `内置 Node 兜底转换器不支持 ${ext || '该'} 格式`)
  }
  const { buf, entries } = readZip(srcPath)
  let body
  if (ext === '.docx' || ext === '.docm') body = docxToMarkdown(buf, entries, opt)
  else if (ext === '.xlsx' || ext === '.xlsm') body = xlsxToMarkdown(buf, entries, opt)
  else body = pptxToMarkdown(buf, entries)

  if (!body || !body.trim()) throw new Error('未能从文件中提取到任何文本内容')

  const lines = [
    '<!-- 由 dsh-plugin-office-markdown 内置 Node 兜底转换器生成（非 MarkItDown），版式/图表/批注/图片/公式等信息可能缺失，保真度有限。 -->',
    `> 源文件：\`${path.basename(srcPath)}\``,
    '> 转换器：内置兜底（fallback-node.js，纯 Node，无需 Python）',
    '',
    body,
    '',
    '---',
    '',
    '**转换提示**',
    '',
    '- 本转换完全在本地完成：未联网、未调用任何 API、未修改原文件。',
    '- 纯 Node 解析 OOXML（zip + xml），不保留版式、图表、批注、图片、公式与扫描件 OCR。',
    '- 如需更高保真度：有网络时用 `uvx markitdown`，或安装 `pip install "markitdown[all]"`。'
  ]
  const text = lines.join('\n')
  fs.mkdirSync(path.dirname(dstPath), { recursive: true })
  fs.writeFileSync(dstPath, text, 'utf8')
  return { bytes: Buffer.byteLength(text, 'utf8'), chars: text.length }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argv = process.argv.slice(2)
  const arg = (flag, fallback) => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
  }
  const input = arg('--input')
  const output = arg('--output')
  if (!input || !output) {
    console.error('usage: node fallback-node.js --input <src> --output <dst> [--max-rows N] [--max-cols N] [--max-cells N]')
    process.exit(2)
  }
  try {
    const result = convertFileNode(input, output, {
      maxRowsPerSheet: Number(arg('--max-rows', NODE_DEFAULTS.maxRowsPerSheet)),
      maxTableCols: Number(arg('--max-cols', NODE_DEFAULTS.maxTableCols)),
      maxCellsPerSheet: Number(arg('--max-cells', NODE_DEFAULTS.maxCellsPerSheet))
    })
    console.log(`OK ${result.bytes} bytes -> ${output}`)
  } catch (error) {
    console.error(String((error && error.message) || error))
    process.exit(2)
  }
}