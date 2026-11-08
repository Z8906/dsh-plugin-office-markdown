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

/* ------------------------------------------------------------------ *
 * 本文件只有一个职责：记住「上一次工具调用时看到的工作区」。
 *
 *   rememberWorkspace(root)  —— 工具调用时写入（index.js 的 executeTool 里调一次）
 *   lastWorkspace()          —— 设置页读（settings-api.js 的 /workspace-files 用）
 *
 * 为什么只存内存、不落盘：
 *   1) 落盘就会在 ~/.dsh 里留文件，卸载要清理，失败要处理，全是额外风险；
 *   2) 上一轮 DSH 的路径可能早就不是用户现在在用的工作区 —— 宁可空着让用户手填，
 *      也不要拿着过期路径去扫目录。
 * 代价是重启 DSH 后第一次打开设置页时下拉为空，需要再有一次工具调用。
 * ------------------------------------------------------------------ */

/* 只保留最近一次；多会话/多工作区时「最后调用的那个胜出」，这是有意为之。 */
let lastRoot = ''
let lastAt = 0

/** 记下工作区绝对路径。非字符串或空白一律忽略，别让脏值进内存。 */
export function rememberWorkspace(root) {
  if (typeof root !== 'string') return
  const trimmed = root.trim()
  if (trimmed === '') return
  lastRoot = trimmed
  lastAt = Date.now()
}

/** 读回最近工作区；从没写过时 root 是空串，at 是 0。 */
export function lastWorkspace() {
  return { root: lastRoot, at: lastAt }
}