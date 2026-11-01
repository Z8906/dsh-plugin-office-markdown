/*!
 * dsh-plugin-office-markdown — last workspace seen by a tool call (host half)
 *
 * The settings page runs in an HTTP context and has no session, so it cannot
 * resolve the workspace itself. Every tool call does know it; we keep the last
 * one in memory only — no file, no residue on disk — and the settings page
 * offers it as a file picker.
 *
 * Deliberately not persisted: a stale path from a previous DSH run would send
 * the picker to a directory the user is no longer working in, and an empty
 * picker is a better answer than a wrong one. The page falls back to the
 * manual absolute-path input when this returns ''.
 */

let lastRoot = ''
let lastAt = 0

export function rememberWorkspace(root) {
  if (typeof root !== 'string') return
  const trimmed = root.trim()
  if (trimmed === '') return
  lastRoot = trimmed
  lastAt = Date.now()
}

export function lastWorkspace() {
  return { root: lastRoot, at: lastAt }
}