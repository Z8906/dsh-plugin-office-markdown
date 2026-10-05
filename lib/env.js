/*!
 * dsh-plugin-office-markdown — Python environment manager (host half)
 *
 * Owns the "check / install / uninstall" lifecycle for MarkItDown, so the
 * plugin never installs anything on its own:
 *
 *   - `inspectEnvironments()` reports every Python candidate the plugin can
 *     see, whether it has pip, and whether it already carries markitdown.
 *     This is what the settings page renders.
 *   - `installMarkitdown()` runs `pip install "markitdown[all]"` into ONE
 *     chosen interpreter and writes a snapshot of the package set before and
 *     after, so the restore step touches only what this plugin added.
 *   - `uninstallMarkitdown()` uninstalls exactly the packages named in that
 *     snapshot and then deletes it. A machine where the user installed
 *     markitdown themselves has no snapshot, so nothing is ever removed.
 *
 * The snapshot lives at `~/.dsh/dsh-plugin-office-markdown.env.json` — a fixed
 * location both this module and `install.ps1` agree on, independent of which
 * profile is in use.
 */
import fs from 'node:fs'
import path from 'node:path'

import { pythonCandidates, pythonSourceLabel, run } from './convert.js'
import { dshHome } from './paths.js'

export const SNAPSHOT_BASENAME = 'dsh-plugin-office-markdown.env.json'
export const MARKITDOWN_REQUIREMENT = 'markitdown[all]'

/* `pip freeze` / `pip show` on a cold interpreter can genuinely take a while. */
const PROBE_TIMEOUT = 60000
const INSTALL_TIMEOUT = 900000

/* A bare `python --version` must not: if it has not answered in five seconds,
 * something is very wrong (a broken shim, an antivirus scan, a Windows Store
 * stub waiting on input) and waiting longer only freezes the settings page.
 * Each candidate additionally gets a total budget, because five hangs of five
 * seconds add up to twenty-five. */
const PROBE_SPAWN_TIMEOUT = 5000
const PROBE_CANDIDATE_BUDGET = 9000
const DEFAULT_PROBE_TTL_MS = 600000

/** Resolve `promise`, or give up after `ms` and use `onTimeout()`. */
function withBudget(promise, ms, onTimeout) {
  let timer = null
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms)
    if (timer && typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([promise, guard]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function firstLine(text) {
  const s = String(text || '').replace(/\r/g, '')
  const line = s.split('\n').find((l) => l.trim())
  return line ? line.trim().slice(0, 300) : ''
}

function tailLines(text, n) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim())
  return lines.slice(-n).join('\n')
}

/** Absolute path of the env snapshot shared with `install.ps1`. */
export function snapshotPath() {
  return path.join(dshHome(), SNAPSHOT_BASENAME)
}

/**
 * 记录里的解释器是不是**确证**没了。
 *
 * 只认 `ENOENT`：权限不足（EACCES / EPERM）、网络盘暂时离线等情况同样会让
 * `fs.existsSync()` 返回 false，但那些情况下包还在原地，删掉记录就等于把
 * 「本插件负责哪些包」这条唯一的凭据丢了。所以只有确证不存在才算失效。
 */
export function interpreterGone(p) {
  if (!p) return false
  try {
    fs.statSync(p)
    return false
  } catch (error) {
    return !!error && error.code === 'ENOENT'
  }
}

export function readSnapshot() {
  try {
    const p = snapshotPath()
    if (!fs.existsSync(p)) return null
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'))
    return obj && typeof obj === 'object' ? obj : null
  } catch {
    return null
  }
}

export function writeSnapshot(obj) {
  const p = snapshotPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8')
  return p
}

export function removeSnapshot() {
  try {
    fs.rmSync(snapshotPath(), { force: true })
    return true
  } catch {
    return false
  }
}

export function snapshotSummary() {
  const snap = readSnapshot()
  if (!snap) return { present: false }
  const python = snap.python || snap.pythonCommand || ''
  return {
    present: true,
    adopted: snap.adopted === true,
    path: snapshotPath(),
    python,
    pythonSourceLabel: pythonSourceLabel(snap.pythonSource),
    installedAt: snap.installedAt || '',
    added: Array.isArray(snap.added) ? snap.added : [],
    keep: Array.isArray(snap.keep) ? snap.keep : [],
    // 记录里的解释器可能已经不在了（被删除，或 DSH 升级换了运行时路径）。
    // 那种记录再也执行不了 pip，必须在 UI 上如实标出来，否则用户看到的只是
    // 一个卸不掉、也清不掉的「幽灵环境」。
    stale: interpreterGone(python)
  }
}

/** Display form of a candidate, e.g. `py -3` — also its identity in the API. */
export function commandOf(cand) {
  const prefix = cand && Array.isArray(cand.prefix) ? cand.prefix : []
  return [cand.cmd, ...prefix].join(' ')
}

async function pipFreeze(cand, options = {}) {
  const r = await run(cand.cmd, [...(cand.prefix || []), '-m', 'pip', 'freeze'], {
    timeoutMs: options.timeoutMs || PROBE_TIMEOUT,
    signal: options.signal
  })
  if (!r.ok) return null
  const names = []
  for (const line of String(r.stdout || '').replace(/\r/g, '').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('-')) continue
    const at = t.indexOf('==')
    names.push(at > 0 ? t.slice(0, at) : t)
  }
  return names
}

/**
 * Inspect ONE Python candidate: does it run, does it have pip, does it already
 * carry markitdown. Never throws — a broken candidate comes back with `error`.
 */
async function inspectCandidateSteps(cand, options = {}) {
  const out = {
    command: commandOf(cand),
    source: cand.source,
    sourceLabel: pythonSourceLabel(cand.source),
    usable: false,
    hasPip: false,
    hasMarkitdown: false,
    markitdownVersion: '',
    pythonVersion: '',
    executable: '',
    pending: false,
    error: ''
  }
  const prefix = cand.prefix || []
  const timeoutMs = options.timeoutMs || PROBE_SPAWN_TIMEOUT

  const ver = await run(cand.cmd, [...prefix, '--version'], { timeoutMs, signal: options.signal })
  if (!ver.ok) {
    out.error = firstLine(ver.stderr) || firstLine(ver.stdout) || '无法执行'
    return out
  }
  out.usable = true
  out.pythonVersion = firstLine(ver.stdout) || firstLine(ver.stderr)

  const exe = await run(cand.cmd, [...prefix, '-c', 'import sys; print(sys.executable)'], { timeoutMs, signal: options.signal })
  if (exe.ok) out.executable = firstLine(exe.stdout)

  const pip = await run(cand.cmd, [...prefix, '-m', 'pip', '--version'], { timeoutMs, signal: options.signal })
  out.hasPip = !!pip.ok
  if (!out.hasPip) {
    out.error = firstLine(pip.stderr) || '没有 pip'
    return out
  }

  const mkd = await run(cand.cmd, [...prefix, '-m', 'markitdown', '--help'], { timeoutMs, signal: options.signal })
  out.hasMarkitdown = !!mkd.ok
  if (out.hasMarkitdown) {
    const show = await run(cand.cmd, [...prefix, '-m', 'pip', 'show', 'markitdown'], { timeoutMs, signal: options.signal })
    const m = String(show.stdout || '').match(/^Version:\s*(\S+)/m)
    out.markitdownVersion = m ? m[1] : ''
  } else {
    out.error = firstLine(mkd.stderr) || '未安装 markitdown'
  }
  return out
}

/** A candidate that never answered, described well enough for the page. */
function pendingCandidate(cand, note) {
  return {
    command: commandOf(cand),
    source: cand.source,
    sourceLabel: pythonSourceLabel(cand.source),
    usable: false,
    hasPip: false,
    hasMarkitdown: false,
    markitdownVersion: '',
    pythonVersion: '',
    executable: '',
    pending: true,
    error: note
  }
}

/**
 * Inspect ONE Python candidate: does it run, does it have pip, does it already
 * carry markitdown. Never throws and never hangs: a broken candidate comes back
 * with `error`, a stuck one with `pending` and `error`.
 */
export async function inspectCandidate(cand, options = {}) {
  const budget = Number(options.budgetMs) || PROBE_CANDIDATE_BUDGET
  const steps = inspectCandidateSteps(cand, options)
  /* Keep the steps alive so an abandoned probe cannot surface as an unhandled
   * rejection once the budget has already answered. */
  steps.catch(() => {})
  return withBudget(steps, budget, () => pendingCandidate(cand, '探测超时（' + Math.round(budget / 1000) + 's 未响应），可点「重新检查」再试。'))
}

/** Key that identifies "the same set of candidates in the same order". */
function probeCacheKey(cfg) {
  const commands = pythonCandidates(cfg).map((cand) => commandOf(cand))
  return String((cfg && cfg.pythonPrefer) || 'auto') + '|' + commands.join(',')
}

let probeCache = null

/**
 * Drop the cached probe result, so the next inspection really re-runs.
 * Used when the interpreter list itself changed (install / uninstall).
 */
export function invalidateProbeCache() {
  probeCache = null
}

/**
 * Inspect every candidate.
 *
 * Candidates are probed in parallel — serially, one stuck interpreter used to
 * hold the whole settings page hostage — while each candidate's own five
 * process spawns stay sequential, because they depend on each other. The result
 * is cached for `cfg.probeTtlMs`, so opening the settings page twice does not
 * spawn twenty processes twice.
 */
export async function inspectEnvironments(cfg, options = {}) {
  const ttl = Math.max(0, Number((cfg && cfg.probeTtlMs) || DEFAULT_PROBE_TTL_MS))
  const key = probeCacheKey(cfg)
  if (!options.force && ttl > 0 && probeCache && probeCache.key === key && Date.now() - probeCache.at < ttl) {
    return { ...probeCache.value, cached: true, budgetMs: 0 }
  }

  const candidates = pythonCandidates(cfg)
  const settled = await Promise.allSettled(
    candidates.map((cand) => inspectCandidate(cand, options))
  )
  const list = settled.map((entry, i) => {
    if (entry.status === 'fulfilled' && entry.value) return entry.value
    const reason = entry.status === 'rejected' ? entry.reason : null
    return pendingCandidate(
      candidates[i],
      '探测失败：' + (firstLine(String((reason && reason.message) || reason)) || '未知原因')
    )
  })

  const active = list.find((e) => e.hasMarkitdown) || null
  const installable = list.find((e) => e.usable && e.hasPip) || null
  const value = {
    pythonPrefer: String((cfg && cfg.pythonPrefer) || 'auto'),
    candidates: list,
    active: active ? active.command : '',
    installTarget: installable ? installable.command : '',
    snapshot: snapshotSummary()
  }
  probeCache = { key, at: Date.now(), value }
  return { ...value, cached: false, budgetMs: PROBE_CANDIDATE_BUDGET }
}

/** The interpreter a fresh install would go into (first usable one with pip). */
export function pickInstallTarget(cfg) {
  for (const cand of pythonCandidates(cfg)) {
    const command = commandOf(cand)
    if (command) return cand
  }
  return null
}

/* ------------------------------------------------------------------ */
/* recording an environment that was already there                     */
/* ------------------------------------------------------------------ */

/** PEP 503 normalised name: lowercase, runs of `-_.` collapse into one `-`. */
export function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/[-_.]+/g, '-')
}

/**
 * Packages that belong to the interpreter rather than to us.
 *
 * A DSH bundled runtime ships a `runtime.json` that lists exactly what the
 * runtime is expected to contain (numpy, pandas, python-docx, Pillow, lxml …).
 * Those are shared with other DSH features, so they must never end up in the
 * removal list even when markitdown happens to depend on them.
 */
export function protectedPackages(cand, executable) {
  const names = new Set(['pip', 'setuptools', 'wheel'])
  const abs = String(executable || (cand && cand.cmd) || '')
  if (abs) {
    let dir = path.dirname(abs)
    for (let i = 0; i < 4 && dir && dir !== path.dirname(dir); i += 1) {
      const manifest = path.join(dir, 'runtime.json')
      try {
        if (fs.existsSync(manifest)) {
          const obj = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''))
          const pkgs = obj && obj.pythonPackages
          if (pkgs && typeof pkgs === 'object') {
            for (const key of Object.keys(pkgs)) names.add(normName(key))
          }
        }
      } catch { /* unreadable manifest — keep walking up */ }
      dir = path.dirname(dir)
    }
  }
  return [...names]
}

/**
 * Python program that answers: "if markitdown were removed, which installed
 * distributions would nobody else still need?" It walks the dependency closure
 * of markitdown, then keeps back anything the runtime manifest protects or
 * anything an installed package outside the closure still requires.
 */
const REMOVABLE_SCRIPT = String.raw`
import json, re, sys
from importlib import metadata as md

payload = json.loads(sys.argv[1])

def norm(n):
    return re.sub(r"[-_.]+", "-", str(n)).lower()

def rname(s):
    m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", str(s))
    return norm(m.group(1)) if m else ""

roots = [norm(r) for r in payload.get("roots", ["markitdown"])]
protected = set(norm(p) for p in payload.get("protected", []))

dists = {}
for d in md.distributions():
    try:
        nm = d.metadata["Name"]
    except Exception:
        nm = None
    if nm and norm(nm) not in dists:
        dists[norm(nm)] = d

requires = {}
for n, d in dists.items():
    kids = []
    try:
        raw = list(d.requires or [])
    except Exception:
        raw = []
    for r in raw:
        k = rname(r)
        if k and k not in kids:
            kids.append(k)
    requires[n] = kids

required_by = {}
for n, kids in requires.items():
    for k in kids:
        required_by.setdefault(k, set()).add(n)

closure = set()
stack = [r for r in roots if r in dists]
while stack:
    n = stack.pop()
    if n in closure:
        continue
    closure.add(n)
    for k in requires.get(n, []):
        if k not in closure and k in dists:
            stack.append(k)

removable, keep = [], []
for n in sorted(closure):
    if n in protected:
        keep.append({"name": n, "reason": "\u8fd0\u884c\u65f6\u81ea\u5e26\uff0c\u4e0d\u6e05\u7406"})
        continue
    outside = sorted(x for x in required_by.get(n, set()) if x not in closure)
    if outside:
        keep.append({"name": n, "reason": "\u88ab\u5176\u5b83\u7ec4\u4ef6\u4f9d\u8d56\uff1a" + ", ".join(outside[:4])})
    else:
        removable.append(n)

print(json.dumps({
    "ok": True,
    "roots": roots,
    "missingRoots": [r for r in roots if r not in dists],
    "closure": sorted(closure),
    "removable": removable,
    "keep": keep,
}))
`

/** Run {@link REMOVABLE_SCRIPT} against one interpreter. */
async function computeRemovableSet(cand, options = {}) {
  const prefix = cand.prefix || []
  const exe = await run(cand.cmd, [...prefix, '-c', 'import sys; print(sys.executable)'], {
    timeoutMs: PROBE_TIMEOUT,
    signal: options.signal
  })
  const executable = firstLine(exe.stdout) || ''

  const payload = JSON.stringify({
    roots: ['markitdown'],
    protected: protectedPackages(cand, executable)
  })
  const r = await run(cand.cmd, [...prefix, '-c', REMOVABLE_SCRIPT, payload], {
    timeoutMs: options.timeoutMs || PROBE_TIMEOUT * 3,
    signal: options.signal
  })
  if (!r.ok) {
    return {
      ok: false,
      executable,
      error: firstLine(r.stderr) || '无法计算依赖关系（退出码 ' + r.code + '）'
    }
  }
  try {
    const line = String(r.stdout || '').trim().split('\n').pop()
    const data = JSON.parse(line)
    return { ok: true, executable, data }
  } catch (error) {
    return {
      ok: false,
      executable,
      error: '无法解析依赖计算结果：' + firstLine(String((error && error.message) || error))
    }
  }
}

/**
 * Record an interpreter that already carries markitdown but has no snapshot, so
 * that removing the plugin can also take those packages back out.
 *
 * This is what the settings page does when the user presses "one-click setup"
 * on an interpreter that already has markitdown: nothing is installed, only a
 * removal manifest is written. `adopted: true` marks it as such.
 *
 * @returns {Promise<{ok: boolean, adopted?: boolean, target: string, added?: string[], keep?: Array<object>, error?: string}>}
 */
export async function adoptMarkitdown(cand, options = {}) {
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {}
  const calc = await computeRemovableSet(cand, options)
  if (!calc.ok) return { ok: false, target: commandOf(cand), error: calc.error }

  const removable = calc.data.removable || []
  const keep = calc.data.keep || []
  if (!removable.length) {
    return {
      ok: false,
      target: commandOf(cand),
      error: '没能算出可以安全卸载的包（可能 markitdown 的依赖全部由运行时提供），未写入环境记录。'
    }
  }

  const snapPath = writeSnapshot({
    version: 1,
    adopted: true,
    packageName: 'dsh-plugin-office-markdown',
    requirement: MARKITDOWN_REQUIREMENT,
    python: calc.executable || commandOf(cand),
    pythonCommand: commandOf(cand),
    pythonSource: cand.source,
    installedAt: new Date().toISOString(),
    added: removable,
    keep,
    closure: calc.data.closure || [],
    before: [],
    after: []
  })

  onLog('已登记现有 MarkItDown 环境：' + removable.length + ' 个包可在卸载插件时一并移除，'
    + keep.length + ' 个包因被其它组件共用而保留。')
  return {
    ok: true,
    adopted: true,
    target: commandOf(cand),
    executable: calc.executable,
    added: removable,
    keep,
    snapshotPath: snapPath
  }
}

/**
 * Install markitdown into `cand` and snapshot the delta.
 * Returns `{ ok, added, target, output, error }`.
 */
export async function installMarkitdown(cfg, cand, options = {}) {
  const prefix = cand.prefix || []
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {}
  const timeoutMs = options.timeoutMs || INSTALL_TIMEOUT

  onLog('检查 ' + commandOf(cand) + ' 的现有包清单…')
  const before = await pipFreeze(cand, { timeoutMs: PROBE_TIMEOUT, signal: options.signal })
  if (before === null) {
    return { ok: false, target: commandOf(cand), added: [], error: '无法执行 pip freeze（该解释器可能没有 pip）' }
  }

  onLog('正在安装 ' + MARKITDOWN_REQUIREMENT + '（约 90 MB，需要联网，可能需要几分钟）…')
  const r = await run(
    cand.cmd,
    [...prefix, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--progress-bar', 'off', MARKITDOWN_REQUIREMENT],
    { timeoutMs, signal: options.signal }
  )
  if (!r.ok) {
    return {
      ok: false,
      target: commandOf(cand),
      added: [],
      error: (r.timedOut ? '安装超时。\n' : '') + (tailLines(r.stderr, 8) || tailLines(r.stdout, 8) || 'pip 退出码 ' + r.code)
    }
  }

  const after = await pipFreeze(cand, { timeoutMs: PROBE_TIMEOUT, signal: options.signal })
  const beforeSet = new Set(before)
  const added = (after || []).filter((n) => !beforeSet.has(n))

  const exe = await run(cand.cmd, [...prefix, '-c', 'import sys; print(sys.executable)'], { timeoutMs: PROBE_TIMEOUT, signal: options.signal })
  const executable = firstLine(exe.stdout) || ''

  const verified = await run(cand.cmd, [...prefix, '-m', 'markitdown', '--help'], { timeoutMs: PROBE_TIMEOUT, signal: options.signal })
  if (!verified.ok) {
    return { ok: false, target: commandOf(cand), added, error: '安装命令成功，但随后无法运行 markitdown：' + firstLine(verified.stderr) }
  }

  const snapPath = writeSnapshot({
    version: 1,
    adopted: false,
    packageName: 'dsh-plugin-office-markdown',
    requirement: MARKITDOWN_REQUIREMENT,
    python: executable || commandOf(cand),
    pythonCommand: commandOf(cand),
    pythonSource: cand.source,
    installedAt: new Date().toISOString(),
    added,
    keep: [],
    before,
    after: after || []
  })

  onLog('已安装 ' + added.length + ' 个新包，环境快照写入 ' + snapPath)
  return { ok: true, target: commandOf(cand), executable, added, snapshotPath: snapPath, output: tailLines(r.stdout, 4) }
}

/**
 * Uninstall exactly what the snapshot recorded. No snapshot (or an empty
 * delta) means the user installed markitdown themselves — nothing is removed.
 */
export async function uninstallMarkitdown(options = {}) {
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {}
  const snap = readSnapshot()
  if (!snap) {
    return { ok: true, skipped: true, reason: '没有环境快照：markitdown 不是由本插件安装或登记的，不会卸载任何东西。' }
  }
  const adopted = snap.adopted === true
  const added = (Array.isArray(snap.added) ? snap.added : []).filter((n) => typeof n === 'string' && n)
  if (added.length === 0) {
    removeSnapshot()
    return { ok: true, skipped: true, reason: '快照里没有可移除的包，已删除快照。', snapshotPath: snapshotPath() }
  }
  const python = snap.python || snap.pythonCommand
  if (!python) {
    return { ok: false, adopted, error: '快照里没有记录 Python 解释器路径，无法自动卸载。', added }
  }

  // 解释器已经不在了（被删除，或 DSH 升级换了运行时路径）：包必然随它一起消失，
  // 这里直接清掉这条无人认领的记录。否则 spawn 会以 ENOENT 失败，而下面的失败
  // 路径又故意保留快照等待重试 —— 「卸载环境」就成了一个永远失败、永远清不掉的按钮。
  if (interpreterGone(python)) {
    removeSnapshot()
    onLog('记录的 Python 解释器已不存在：' + python + '；环境已随它消失，已清理这条记录。')
    return {
      ok: true,
      orphan: true,
      removed: [],
      python,
      reason: '记录的 Python 解释器已不存在，环境已随之消失，已删除这条失效记录。'
    }
  }

  onLog((adopted ? '正在移除本插件登记过的 ' : '正在从 ') + python + ' 卸载 ' + added.length + ' 个包…')
  const r = await run(python, ['-m', 'pip', 'uninstall', '-y', '--disable-pip-version-check', ...added], {
    timeoutMs: options.timeoutMs || INSTALL_TIMEOUT,
    signal: options.signal
  })

  const interesting = String((r.stdout || '') + '\n' + (r.stderr || ''))
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => /Successfully uninstalled|not installed|^ERROR|Skipping/i.test(l))
    .map((l) => l.trim())
    .slice(0, 40)

  if (r.ok) {
    removeSnapshot()
    return { ok: true, adopted, removed: added, python, output: interesting, snapshotPath: snapshotPath() }
  }
  return {
    ok: false,
    adopted,
    added,
    python,
    output: interesting,
    error: (r.timedOut ? '卸载超时。\n' : '') + (tailLines(r.stderr, 6) || 'pip 退出码 ' + r.code)
  }
}