/**
 * 卸载看门狗：把「一并清掉本插件带来的 Python 环境」这件事交给一个**脱离
 * DSH 宿主**的进程去做。
 *
 * 为什么要脱离宿主：`@deepseek-ai/dsh-plugin-manager` 的 `removeBundle()`
 * 顺序是 `selectBundle(name, false)` → `reload()` → `pnpm remove <name>`
 * （index.js:1844-1863）。也就是说本插件的 fiber 会先被销毁，几秒之后包目录
 * 才被 pnpm 删掉；在这中间用户完全可能顺手重启一次 harness，一旦宿主退出，
 * 宿主内的定时器就全部消失，环境就永远清不掉了。
 *
 * 所以这里在 dispose 时写一个自包含的 Python 脚本到临时目录，用派生的
 * headless 解释器进程执行它：该进程在自己的父进程退出后依然存活，轮询到
 * 「包目录已消失 **且** 没有任何 profile 配置再引用本插件」时才动手，最后
 * 把环境记录和它自己的临时文件一起删掉。
 *
 * 判定条件与 `lib/index.js` 的 `removalConfirmed()` 刻意保持一致，宁可漏清
 * 也不能误清：关闭插件、停用插件、重载 profile、退出 DSH 都只是 dispose，
 * 都不是卸载。
 *
 * 派发时机由 `lib/index.js` 的 `scheduleRemovalCleanup()` 决定：它只在 dispose
 * 那一刻发现本插件已经从 profile 的 `dsh.profile.bundles` 里被摘掉时才起这个
 * 进程。正常关闭插件、正常重启 DSH 时 bundles 里仍然有本插件，因此根本不会
 * 派发，平时不会有任何常驻进程。
 *
 * 即便真的派发了，也会用 `lockPath` 抢一个单实例锁：同一时间最多只有一个看门狗
 * 在跑，连着重启几次也不会把同一个环境卸载好几遍。
 *
 * 日志（`logPath`）只在**没清干净**的时候才需要：清理成功的那一刻，它就从事后排查
 * 的证据变成了留在用户 `~/.dsh` 里的垃圾，而本插件被卸载之后，这台机器上再没有
 * 任何代码会来收拾它。所以成功路径把日志压成一行摘要，失败 / 超时 / 未确认则保留
 * 完整转录。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { interpreterGone } from './env.js'

/** 看门狗本体。写成 Python 是因为要执行的正是 `pip uninstall`，不必再借道 node。 */
const WATCHDOG_PY = String.raw`# -*- coding: utf-8 -*-
"""卸载看门狗：等 DSH 真正把 dsh-plugin-office-markdown 移除后，卸载它带来的 Python 包。"""
import datetime
import json
import os
import subprocess
import sys
import time

cfg_path = sys.argv[1]
with open(cfg_path, "r", encoding="utf-8-sig") as fh:
    cfg = json.load(fh)

LOG = cfg.get("logPath") or ""
MAX_LOG_BYTES = int(cfg.get("maxLogBytes") or 65536)
KEEP_LOG_BYTES = int(cfg.get("keepLogBytes") or 16384)

def _rotate_log():
    """Keep the log bounded.

    It is opened in append mode and lives outside the plugin package (which is
    deleted on uninstall), so a machine that installs / uninstalls this plugin
    repeatedly would otherwise accumulate one full pip transcript per removal,
    forever. Trim from the front, on a record boundary, before writing anything.
    """
    if not LOG:
        return
    try:
        size = os.path.getsize(LOG)
    except OSError:
        return
    if size <= MAX_LOG_BYTES:
        return
    try:
        with open(LOG, "rb") as fh:
            fh.seek(max(0, size - KEEP_LOG_BYTES))
            tail = fh.read()
    except OSError:
        return
    cut = tail.find(b"\n")            # never leave a half-written first line
    if cut >= 0:
        tail = tail[cut + 1:]
    header = ("[%s] （更早的卸载记录已省略，仅保留最近约 %d KB）\n"
              % (datetime.datetime.now().isoformat(timespec="seconds"),
                 KEEP_LOG_BYTES // 1024)).encode("utf-8")
    try:
        with open(LOG, "wb") as fh:
            fh.write(header + tail)
    except OSError:
        pass

_rotate_log()

def log(message):
    line = "[%s] %s" % (datetime.datetime.now().isoformat(timespec="seconds"), message)
    if not LOG:
        return
    try:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass

def gone():
    """包目录已经不在，并且没有任何 profile 配置还引用本插件。"""
    marker = os.path.join(cfg["packageRoot"], "lib", "index.js")
    try:
        if os.path.exists(marker):
            return False
    except OSError:
        return False
    root = cfg["profilesRoot"]
    try:
        profiles = os.listdir(root)
    except OSError:
        return False
    for profile in profiles:
        for candidate in ("cordis.patch.yml", "cordis.patch.yaml", "cordis.yml", "package.json"):
            target = os.path.join(root, profile, candidate)
            try:
                if not os.path.exists(target):
                    continue
                with open(target, "r", encoding="utf-8", errors="replace") as fh:
                    if "office-markdown" in fh.read():
                        return False
            except OSError:
                return False
    return True

def remove_self_files():
    for item in cfg.get("selfFiles") or []:
        try:
            os.remove(item)
        except OSError:
            pass

def release_lock():
    lock = cfg.get("lockPath") or ""
    if not lock:
        return
    try:
        os.remove(lock)
    except OSError:
        pass

def cleanup_self():
    remove_self_files()
    release_lock()

def compact_log(summary):
    """成功卸载只留一行摘要。

    完整转录是给「没清干净」用的排查材料。清理既然成功了，它就从证据变成了
    插件留在用户 ~/.dsh 里的垃圾 —— 而本插件被卸载之后，这台机器上再没有任何
    本插件的代码会来收拾它。所以成功时压成一行，失败 / 超时则原样保留。
    """
    if not LOG:
        return
    stamp = datetime.datetime.now().isoformat(timespec="seconds")
    text = ("[%s] %s\n"
            "[%s] （本次卸载成功，只保留这一行摘要；失败或超时会保留完整转录）\n"
            % (stamp, summary or "卸载完成", stamp))
    try:
        with open(LOG, "w", encoding="utf-8") as fh:
            fh.write(text)
    except OSError:
        pass

def finish(success, summary):
    """收尾：清掉自己的临时文件与锁；成功时顺便把日志压成一行。"""
    cleanup_self()
    if success:
        compact_log(summary)
    else:
        log("卸载看门狗结束：清理未完成，完整记录保留供排查。")

def acquire_lock():
    """同一时间只允许一个看门狗活着。

    每次 dispose（关闭插件、重载 profile、退出 DSH…）都可能派发一个新进程，
    所以这里用 O_CREAT|O_EXCL 抢一个锁文件：抢不到就说明已经有一个在跑，本进程
    立刻退出，免得同一个环境被卸载好几遍。上一个看门狗崩溃留下的过期锁会被
    忽略并接管。
    """
    lock = cfg.get("lockPath") or ""
    if not lock:
        return True
    stale_after = float(cfg.get("timeoutSec") or 120) + 60
    try:
        handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(handle, ("%d\n" % os.getpid()).encode("utf-8"))
        os.close(handle)
        return True
    except FileExistsError:
        pass
    except OSError:
        return True
    try:
        age = time.time() - os.path.getmtime(lock)
    except OSError:
        return True
    if age <= stale_after:
        return False
    try:
        os.remove(lock)
        handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(handle, ("%d\n" % os.getpid()).encode("utf-8"))
        os.close(handle)
        return True
    except OSError:
        return False

if not acquire_lock():
    log("已有一个卸载看门狗在运行，本进程直接退出，不清理任何东西。")
    remove_self_files()
    sys.exit(0)

timeout = float(cfg.get("timeoutSec") or 120)
fast_window = float(cfg.get("pollFastWindowSec") or 30)
fast_poll = float(cfg.get("pollFastSec") or 2)
slow_poll = float(cfg.get("pollSlowSec") or 10)

started = time.time()
deadline = started + timeout
confirmed = False
while time.time() < deadline:
    try:
        if gone():
            confirmed = True
            break
    except Exception as error:  # noqa: BLE001 - 看门狗绝不能自己炸掉
        log("判定卸载状态时出错，继续等待：%r" % (error,))
    # 卸载通常在几秒内完成：前 30 秒查得密一点，之后就松下来省资源。
    delay = fast_poll if (time.time() - started) < fast_window else slow_poll
    remaining = deadline - time.time()
    if remaining <= 0:
        break
    time.sleep(delay if delay < remaining else remaining)

if not confirmed:
    log("等待 %d 秒仍未确认插件被移除（包目录或 profile 配置仍引用它），本次不清理任何东西。"
        % int(timeout))
    finish(False, "")
    sys.exit(0)

log("已确认 dsh-plugin-office-markdown 从 profile 移除，开始处理 Python 环境。")

snapshot = cfg.get("snapshotPath") or ""
if not snapshot or not os.path.exists(snapshot):
    finish(True, "无需清理：没有环境记录（markitdown 不是由本插件登记或安装的）")
    sys.exit(0)

packages = [p for p in (cfg.get("packages") or []) if isinstance(p, str) and p]
python = cfg.get("python") or ""
ok = True          # 只有「该做的事都做成了」才算成功；否则保留完整转录
summary = ""
if not packages:
    log("环境记录里没有需要负责的包，直接删除记录。")
    summary = "无需清理：环境记录里没有需要负责的包"
elif not python:
    log("环境记录里没有解释器路径，无法自动卸载。请手工执行：")
    log("  <python> -m pip uninstall -y " + " ".join(packages))
    ok = False
else:
    log("正在用 %s 卸载 %d 个包…" % (python, len(packages)))
    try:
        completed = subprocess.run(
            [python, "-m", "pip", "uninstall", "-y", "--disable-pip-version-check"] + packages,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=float(cfg.get("pipTimeoutSec") or 1800),
        )
        output = (completed.stdout or b"").decode("utf-8", "replace")
        for line in output.splitlines():
            stripped = line.strip()
            if ("Successfully uninstalled" in stripped or "not installed" in stripped
                    or stripped.startswith("ERROR") or stripped.startswith("Skipping")):
                log("  " + stripped)
        log("pip 退出码 %s。" % completed.returncode)
        ok = completed.returncode == 0
        summary = "卸载完成：清理 %d 个包，pip 退出码 %s" % (len(packages), completed.returncode)
    except Exception as error:  # noqa: BLE001 - 失败也要留下记录
        log("调用 pip 失败：%r" % (error,))
        ok = False

try:
    os.remove(snapshot)
    log("已删除环境记录 %s。" % snapshot)
except OSError as error:
    log("删除环境记录失败：%r" % (error,))
    ok = False

finish(ok, summary)
`

/**
 * 为一个已登记的环境派发看门狗进程。
 *
 * @param {object} options
 * @param {string} options.packageRoot 本插件包目录（被 pnpm 删掉的那个）。
 * @param {string} options.profilesRoot `<DSH home>/profiles`。
 * @param {string} options.snapshotPath 环境记录文件。
 * @param {string} options.lockPath 单实例锁文件，保证同时只有一个看门狗在跑。
 * @param {string} options.python 记录里的解释器绝对路径。
 * @param {string[]} options.packages 记录里由本插件负责的包。
 * @param {string} options.logPath 看门狗的日志文件。
 * @param {number} [options.timeoutSec] 等待卸载确认的上限，默认 120 秒。
 * @returns {{pid: number|undefined, scriptPath: string, configPath: string, logPath: string}}
 */
export function spawnRemovalWatchdog(options) {
  const stamp = Date.now() + '-' + process.pid + '-' + Math.random().toString(16).slice(2, 8)
  const base = path.join(os.tmpdir(), 'dsh-om-removal-' + stamp)
  const scriptPath = base + '.py'
  const configPath = base + '.json'
  const logPath = options.logPath

  const config = {
    packageRoot: options.packageRoot,
    profilesRoot: options.profilesRoot,
    snapshotPath: options.snapshotPath,
    lockPath: options.lockPath,
    python: options.python,
    packages: options.packages,
    logPath,
    maxLogBytes: options.maxLogBytes ?? 65536,
    keepLogBytes: options.keepLogBytes ?? 16384,
    timeoutSec: options.timeoutSec ?? 120,
    pollFastSec: 2,
    pollFastWindowSec: 30,
    pollSlowSec: 10,
    pipTimeoutSec: 1800,
    selfFiles: [scriptPath, configPath]
  }

  fs.writeFileSync(scriptPath, WATCHDOG_PY, 'utf8')
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')

  // 解释器已经不在了（被删除，或 DSH 升级换了运行时路径）：包必然随它一起消失，
  // 没有可清理的东西。这里写一行结论、清掉失效记录与临时文件就直接返回，
  // 而不是 spawn 一个不存在的解释器、只靠下面的 error 事件把 ENOENT 吞掉。
  if (interpreterGone(options.python)) {
    try {
      fs.appendFileSync(
        logPath,
        '[' + new Date().toISOString() + '] 记录的 Python 解释器已不存在：' + options.python +
          '；环境已随它消失，无需清理，已删除这条失效记录。\n',
        'utf8'
      )
    } catch {}
    if (options.snapshotPath) {
      try {
        fs.rmSync(options.snapshotPath, { force: true })
      } catch {}
    }
    for (const self of [scriptPath, configPath]) {
      try {
        fs.rmSync(self, { force: true })
      } catch {}
    }
    return { pid: undefined, scriptPath, configPath, logPath, skipped: true }
  }

  const child = spawn(options.python, [scriptPath, configPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  // A recorded interpreter can be gone by the time we get here (the user may
  // have deleted that Python). Without this listener the `error` event would be
  // unhandled and would take the host process down with it.
  child.on('error', () => {})
  child.unref()

  return { pid: child.pid, scriptPath, configPath, logPath }
}
