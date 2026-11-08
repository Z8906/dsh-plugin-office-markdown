/*!
 * dsh-plugin-office-markdown — resolving DSH's own directories (host half)
 *
 * The paths this plugin shares with the host used to be spelled out as
 * `path.join(os.homedir(), '.dsh')` in four separate files. That is right on a
 * stock install and wrong the moment DSH keeps its data somewhere else, so the
 * resolution lives here once, for `env.js`, `convert.js` and `index.js` alike.
 *
 * Order of authority:
 *
 *   1. `setProfileDir()` — the profile directory the host itself reports from
 *      `apply(ctx)`. Always correct, and the only source that survives a
 *      non-default layout.
 *   2. `DSH_HOME` — the variable the host exports to the processes it spawns.
 *   3. `~/.dsh` — the host's own default, used when nothing else is known.
 */

/* ------------------------------------------------------------------ *
 * 本文件结构导览
 *
 *   setProfileDir / currentProfileDir  —— 宿主报告的 profile 目录（最权威）
 *   dshHome                             —— DSH 数据目录（默认 ~/.dsh）
 *   profilesRoot                        —— 所有 profile 的父目录
 *   runtimesRoot                        —— DSH 自带的运行时（只读那份在安装目录，
 *                                          这里指的是 .dsh 下可写的那份）
 *   removalLogPath / watchdogLockPath   —— 卸载看门狗的日志与单实例锁
 *
 * 为什么集中到一处：这四条路径以前散落在四个文件里各写一遍，
 * 一旦 DSH 把数据目录换到别处，就会有一半代码还在找 ~/.dsh。
 * ------------------------------------------------------------------ */
import os from 'node:os'
import path from 'node:path'

/** Basename of the removal watchdog's log inside the DSH home. */
/* ---------------- 文件名约定 ---------------- */

/* 两个固定文件名，放在 DSH 数据目录根下。install.ps1 与看门狗也按这两个名字找。 */
export const REMOVAL_LOG_BASENAME = 'dsh-plugin-office-markdown-removal.log'

/** Basename of the single-instance lock that caps the watchdog at one process. */
export const WATCHDOG_LOCK_BASENAME = 'dsh-plugin-office-markdown-watchdog.lock'

let profileDirOverride = ''

/**
 * Remember the profile directory the host is running from.
 *
 * Called once from `apply(ctx)`; a no-op for anything that is not a plain
 * non-empty string, so a surprising host value can never break path resolution.
 */
/* ---------------- 路径解析 ---------------- */

/**
 * 记下宿主报告的 profile 目录（apply 里调一次）。
 * 非字符串或空串一律忽略 —— 宿主的意外值不能把路径解析搞坏。
 */
export function setProfileDir(dir) {
  if (typeof dir !== 'string') return
  const trimmed = dir.trim()
  if (trimmed === '') return
  profileDirOverride = path.resolve(trimmed)
}

/** The profile directory in use, or `''` when the host never told us. */
/** 当前 profile 目录；宿主没说过就返回空串（调用方据此回退到环境变量 / 默认值）。 */
export function currentProfileDir() {
  if (profileDirOverride !== '') return profileDirOverride
  const fromEnv = typeof process.env.DSH_PROFILE_DIR === 'string' ? process.env.DSH_PROFILE_DIR.trim() : ''
  return fromEnv === '' ? '' : path.resolve(fromEnv)
}

/** DSH's data directory — `~/.dsh` unless the host says otherwise. */
/**
 * DSH 数据目录。优先级：profile 目录往上两级 → DSH_HOME → ~/.dsh。
 * 「profile 目录往上两级」是因为布局固定为 <home>/profiles/<name>。
 */
export function dshHome() {
  const profileDir = currentProfileDir()
  if (profileDir !== '') return path.dirname(path.dirname(profileDir))
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return fromEnv === '' ? path.join(os.homedir(), '.dsh') : path.resolve(fromEnv)
}

/** `<DSH home>/profiles` — the directory every profile lives in. */
/** <DSH home>/profiles —— 所有 profile 的父目录，卸载判定要遍历它。 */
export function profilesRoot() {
  const profileDir = currentProfileDir()
  if (profileDir !== '') return path.dirname(profileDir)
  return path.join(dshHome(), 'profiles')
}

/** Where the removal watchdog appends its log. */
/** 卸载看门狗把每一步写到这里；插件已经被移除时，这是唯一的排查线索。 */
export function removalLogPath() {
  return path.join(dshHome(), REMOVAL_LOG_BASENAME)
}

/** The single-instance lock that keeps at most one removal watchdog alive. */
/** 单实例锁：同一台机器上最多一个看门狗在跑，避免重复卸载。 */
export function watchdogLockPath() {
  return path.join(dshHome(), WATCHDOG_LOCK_BASENAME)
}

/** `<DSH home>/dsh-runtimes` — the host's own packaged runtimes. */
/**
 * <DSH home>/dsh-runtimes —— 可写的那份运行时。
 * **不要**把安装目录（resources/runtime）加进来：那里只读，往里 pip 装包必然失败。
 */
export function runtimesRoot() {
  return path.join(dshHome(), 'dsh-runtimes')
}
