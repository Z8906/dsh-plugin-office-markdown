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
import os from 'node:os'
import path from 'node:path'

/** Basename of the removal watchdog's log inside the DSH home. */
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
export function setProfileDir(dir) {
  if (typeof dir !== 'string') return
  const trimmed = dir.trim()
  if (trimmed === '') return
  profileDirOverride = path.resolve(trimmed)
}

/** The profile directory in use, or `''` when the host never told us. */
export function currentProfileDir() {
  if (profileDirOverride !== '') return profileDirOverride
  const fromEnv = typeof process.env.DSH_PROFILE_DIR === 'string' ? process.env.DSH_PROFILE_DIR.trim() : ''
  return fromEnv === '' ? '' : path.resolve(fromEnv)
}

/** DSH's data directory — `~/.dsh` unless the host says otherwise. */
export function dshHome() {
  const profileDir = currentProfileDir()
  if (profileDir !== '') return path.dirname(path.dirname(profileDir))
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return fromEnv === '' ? path.join(os.homedir(), '.dsh') : path.resolve(fromEnv)
}

/** `<DSH home>/profiles` — the directory every profile lives in. */
export function profilesRoot() {
  const profileDir = currentProfileDir()
  if (profileDir !== '') return path.dirname(profileDir)
  return path.join(dshHome(), 'profiles')
}

/** Where the removal watchdog appends its log. */
export function removalLogPath() {
  return path.join(dshHome(), REMOVAL_LOG_BASENAME)
}

/** The single-instance lock that keeps at most one removal watchdog alive. */
export function watchdogLockPath() {
  return path.join(dshHome(), WATCHDOG_LOCK_BASENAME)
}

/** `<DSH home>/dsh-runtimes` — the host's own packaged runtimes. */
export function runtimesRoot() {
  return path.join(dshHome(), 'dsh-runtimes')
}
