# 启用 / 禁用 / 卸载

[← 返回首页](../README.md) ｜ [安装](installation.md) · [产物与文件](artifacts.md) · [配置](configuration.md)

---

## 三种操作的区别

| 目标 | 做法 |
| --- | --- |
| **临时禁用**（等于没装） | DSH 插件管理里关掉 `office-markdown`；或把受管块里 `enabled` 改成 `false` 后重启。**禁用不会卸载任何 Python 包**，也不会启动任何进程 |
| **在 DSH 里卸载插件**（推荐） | DSH **设置 → 插件** 里找到它，点卸载。插件在真正被移除时会**自动**把环境记录里属于它的 Python 包 `pip uninstall` 掉 |
| **彻底卸载（脚本）** | `& "<plugin>\install.ps1" -Uninstall` —— 移除 `cordis.patch.yml` 受管块、删除 `node_modules` 副本、清理 `package.json` 登记、删除卸载日志，**并按环境记录卸载属于本插件的 Python 包** |
| 卸载但想留着 MarkItDown | `& "<plugin>\install.ps1" -Uninstall -KeepMarkitdown` |
| 卸载但想留着卸载日志 | `& "<plugin>\install.ps1" -Uninstall -KeepRemovalLog` |
| **彻底卸载（手动）** | 删除 `<profile>\node_modules\dsh-plugin-office-markdown` 并删掉受管块。**手工删目录不会清理 Python 包**；想一起清，请改用脚本，或先在设置页点「卸载插件配置的环境」 |

`apply()` 在看到 `config.enabled === false` 时**直接返回、不注册任何东西** —— 工具、技能、`read` 守卫、设置页都不会出现，和没装完全一致。

---

## ⚠️ 升级不要走「卸载 → 重装」

本插件在**真正被卸载**时会清理它登记的 Python 环境（下面详述）。DSH 官方的升级提示「插件安装后暂不支持自动更新，升级需先卸载再安装新版」对普通插件成立，**对这个插件是例外** —— 照做会得到「插件升级了、Python 环境却没了」。

正确的升级方式见 [安装文档的升级一节](installation.md)。

如果已经这么做了：重启后打开 **设置 → Office 转换**，点「一键配置 MarkItDown 环境」把环境装回来。

---

## 卸载插件时，Python 环境会一起清掉

这是**只在卸载时**发生的行为；关闭 / 禁用 / 重启都不会触发。

DSH 没有给第三方插件留卸载钩子，而 fiber 被释放这件事在**禁用、关闭、重启、热重载**时同样发生 —— 所以插件必须先判断「这一次到底是不是正在被卸载」。

判定顺序（任一条不满足就直接结束，**不启动任何进程**）：

1. `removeEnvOnUninstall` 是 `false` → 什么都不做；
2. 没有环境记录 → 什么都不做；
3. 记录里没有登记过任何包 → 什么都不做；
4. 包目录 `…/node_modules/dsh-plugin-office-markdown/lib/index.js` 已消失，**且** profile 配置里也不再提到它 → 判定为「已被移除」，**当场直接清理**（连进程都不派发）；
5. 否则，如果 profile 的 `package.json` 里 `dsh.profile.bundles` 仍列着本插件 → 判定为「只是被禁用 / 关闭 / 重启」，到此结束；
6. 只有「包目录还在、但 `bundles` 里已经没有它」这一种情况（DSH 的卸载流程正是如此：先摘掉 bundle 并 reload，几秒后才删目录）—— 才派发一个**脱离宿主的看门狗进程**，由它轮询等待包目录真正消失，确认后再清理。

所以：**平时关闭 / 重启 DSH 不会有任何常驻进程，也不会有任何 Python 包被卸。**

> 注意第 6 步的反面：任何让「`bundles` 里先没有它、包目录随后消失」的操作，都会被判定为卸载。DSH 插件管理里的「卸载」按钮、以及安装流程中"先移除再添加"的步骤都属于这一类 —— 所以升级时别碰它们。

### 看门狗自身的三重保险

- **单实例锁**：`~/.dsh/dsh-plugin-office-markdown-watchdog.lock`。重复派发的进程发现锁还在会立刻自我退出（只清掉自己那对临时文件，绝不碰锁）。
- **寿命上限 120 秒**：前 30 秒每 2 秒查一次，之后每 10 秒查一次，超时放弃并留日志。实测 `pnpm remove` 只要约 2 秒，余量很宽。
- **开销近乎为零**：判断「包目录还在不在」只做一次 `stat`，不读任何文件。实测常驻内存约 13 MB、空闲 12 秒内累计 CPU 0.00 ms。

日志写在 `~/.dsh/dsh-plugin-office-markdown-removal.log`：**清理成功只留一行摘要**，失败 / 超时 / 未确认才保留完整转录（见 [产物与文件](artifacts.md)）。

### 清理范围

严格限定在**环境记录**里：

| 包 | 处理 |
| --- | --- |
| 由本插件 `pip install` 进去的包 | **卸载** |
| 由「一键配置」**登记**过的、原本就存在的 MarkItDown 及依赖（记录里 `adopted: true`，设置页显示「已接管（原本已安装）」） | **卸载** |
| **DSH 运行时自带的包**（`numpy` / `pandas` / `python-docx` / `python-pptx` / `openpyxl` / `Pillow` / `lxml` / `XlsxWriter` 等，清单取自 `~/.dsh/dsh-runtimes/*/runtime.json` 的 `pythonPackages`） | 一律保留 |
| 被**闭包外**其它组件依赖的包 | 一律保留（页面会显示保留数量） |
| **你自己装的、没登记过的 MarkItDown** | 一个都不会动 |

### 关掉这个行为

- `config.removeEnvOnUninstall: false` —— 彻底关掉「卸载时清理 Python 环境」。
- `config.autoAdoptEnv: false` —— 关掉「启动时自动登记 DSH 自带运行时里的 MarkItDown」。

两者都见 [配置](configuration.md)。