# dsh-plugin-office-markdown

让 DeepSeek Harness（DSH）在读取 Office / PDF 文件时**先自动转成 Markdown 再读**：用一行路径代替整份全文注入上下文，从而大幅节省 token。

| | |
| --- | --- |
| **当前推荐版本** | **v1.2.0**（[Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) ｜ [更新日志](CHANGELOG.md)） |
| 许可证 | MIT |
| npm 依赖 | **0 个**（只用 Node 内置模块；`@deepseek-ai/dsh-tools` 由 DSH 自身提供） |
| 运行环境 | DSH（bundle 插件），Node ≥ 18；Python / MarkItDown 全部**可选** |

> **开发方式**：本项目的代码与文档**主要由 DeepSeek 开发**

```
docx / xlsx / pptx / pdf  ──▶  MarkItDown（或内置兜底转换器）  ──▶  源文件旁边的 xxx.md  ──▶  按需 read
        36 KB 的 .docx  →  约 0.5 KB 的 .md（≈115 tokens），原文件一动不动
```

核心特征：

- **转换在本地完成**：不联网（除首次 `uvx` 下载）、不改原文件、不消耗 API 额度。
- **产物只有一个** `.md`，直接写在**源文件旁边**（同目录）；进上下文的只有路径、体积、行数与结构索引。
- **注册三样东西**：工具 `read_office_as_markdown`、一份运行时技能说明、一个可选的 `read` 守卫（拦住直接读取二进制 Office 文件）。
- **自带设置页**：DSH 设置 → **Office 转换**，可检查本机 Python 环境、一键配置 / 一键卸载 MarkItDown、试转一个文件。安装脚本**不会**替你装任何 Python 包。
- **卸载干净**：在 DSH 里移除本插件时，它把自己安装 / 登记过的 MarkItDown 及依赖一并 `pip uninstall`；DSH 运行时自带的包和你自己的包一个都不动。**禁用、关闭、重启都不会触发卸载。**
- **零残留**：除了那个 `.md`，插件不写任何临时目录、登记表或缓存元数据。

---

## 1. 当前版本与状态

### 版本状态

| 版本 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| **v1.2.0** | 🟢 **推荐使用** | 2026-10-02 | 产物保真度标记、结构索引（`outline`）、陈旧产物清理（`clean`）、批量与目录展开、设置页试转、并发环境探测 |
| v1.1.1 | 🟡 过渡版本 | 2026-10-01 | 安装脚本新增 `-RegisterBundle`（一键装成正规 bundle）；转换能力与 v1.1.0 相同 |
| v1.1.0 | 🟠 可用但功能不全 | 2026-10-01 | 新增 `lib/paths.js`（数据目录不再写死）与 `lib/removal-watchdog.js`（卸载时脱离宿主补清 Python 环境） |
| v1.0.0 | 🔴 **无法正常使用** | 2026-10-01 | 首版，存在缺陷、已废弃。**请勿安装**，直接使用 v1.2.0 |

### 关于日期

`v1.0.0` / `v1.1.0` / `v1.1.1` 的 tag 与 Release 是在 **2026-10-01 同一天一次性补建**的（三个 tag 的 tagger 时间同为 `20:58:23`，三个 Release 的发布时间相隔 2 秒），所以这三个版本日期相同；项目实际开发自 **2026-08** 起。`v1.2.0` 的日期（2026-10-02）是真实发布日。

---

## 2. 安装

### 方式 1：在 DSH 的安装框里填一行（推荐）

打开 DSH 的 **设置 → 插件 → 安装**，填入下面这行，回车：

```
github:Z8906/dsh-plugin-office-markdown#v1.2.0
```

它会作为 bundle 装进 profile —— **设置 → 插件** 里能看到它、也能一键卸载。装完**重启 DSH**。

- 想跟最新主干、不锁定版本：`github:Z8906/dsh-plugin-office-markdown`
- 想装历史版本：把 `#v1.2.0` 换成 `#v1.1.1` / `#v1.1.0` / `#v1.0.0`（**均不推荐**，见上表）
- 这条路**要求目标电脑装了 git**（DSH 安装前会先跑一次 `git ls-remote` 预检），并且仓库公开 —— 本仓库两条都满足。
- 目标电脑**没有 git**？用下面方式 2（下载 `.tgz`）或方式 3（源码 + 脚本）。

### 方式 2：下载 `.tgz` 安装（不需要 git）

从 [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) 下载 `dsh-plugin-office-markdown-<版本>.tgz`，在 DSH 的安装入口里**填它的绝对路径**。

也可以手工装：把 tarball 放到固定位置（例如 `%USERPROFILE%\.dsh\local-packages\`），在 `<profile>\package.json` 里改两处，然后在 `<profile>` 目录下执行 `pnpm install`：

```json
{
  "dsh": { "profile": { "bundles": [ "……", "dsh-plugin-office-markdown" ] } },
  "dependencies": {
    "……": "……",
    "dsh-plugin-office-markdown": "file:../../local-packages/dsh-plugin-office-markdown-1.2.0.tgz"
  }
}
```

> **`.tgz` 里有什么**：`package.json`、`cordis.patch.yml`、`README.md`、`LICENSE`、`lib/`（9 个文件）。它**不含 `install.ps1`**，也不含 `CHANGELOG.md` 和 `.github/`（这三者不在 `package.json` 的 `files` 白名单里）—— 需要 `install.ps1` 请走方式 3（`.zip` 源码快照或 `git clone`）。
>
> **`file:` 依赖的缓存规则**：pnpm 按「路径 + 版本号」缓存 `file:` 依赖 —— 内容变了但版本号没变时会直接复用缓存（安装输出里写 `reused`）。所以改完 `lib/` 必须先把 `package.json` 的 `version` 升一位，再重新打包、复制、重装。

### 方式 3：源码 + `install.ps1`（需要脚本时用这条）

拿到源码有两条路，`install.ps1` 只存在于源码里（`.tgz` 不含它）：

- 从 [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) 下载 `dsh-plugin-office-markdown-v<版本>.zip` —— 源码快照，**内含 `install.ps1`**，解压后就是 `dsh-plugin-office-markdown-<版本>\` 目录，**不需要 git**；
- 或 `git clone` 本仓库（含全部历史）：

```powershell
git clone https://github.com/Z8906/dsh-plugin-office-markdown.git
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& ".\dsh-plugin-office-markdown\install.ps1"
```

脚本只做三件事：

1. 把插件复制到 `<profile>\node_modules\dsh-plugin-office-markdown`；
2. **只看不装**：逐个探测本机 Python 解释器（DSH 自带运行时 → 系统 PATH → `py -3`），打印每个有没有 `pip`、有没有装 `markitdown`，并告诉你重启后插件会实际用哪一个；
3. 在 `<profile>\cordis.patch.yml` 末尾写入受管块（`# >>> dsh-plugin-office-markdown` … `# <<< dsh-plugin-office-markdown`）。改文件前备份成 `cordis.patch.yml.bak`（**固定文件名，每次覆盖，不会累积时间戳备份**）。

> **想要「插件」页里的卸载按钮**，加上 `-RegisterBundle`：脚本会打成 tarball 放进 `<DSH 数据目录>\local-packages\`、在 profile `package.json` 里同时登记 `dsh.profile.bundles` 与 `dependencies` 的 `file:` 指向、用 DSH 自带的 pnpm 跑一次 `install`，最后移除它先前写的 `cordis.patch.yml` 受管块（bundle 自带一份，留着会被加载两次）。

```powershell
# 一键装成正规 bundle（「插件」页可见、可一键卸载）
& "<解压路径>\dsh-plugin-office-markdown\install.ps1" -RegisterBundle

# 完全不调用任何 Python（离线安装 / 只想复制文件）
& "...\install.ps1" -SkipEnv

# 装上但先禁用（等价于没装）
& "...\install.ps1" -Disabled

# profile 名不是默认的 desktop
& "...\install.ps1" -ProfileDir "C:\Users\你\.dsh\profiles\<你的 profile>"
```

> **脚本不会自动 `pip install` 任何东西。** 要装 MarkItDown，重启 DSH 后打开 **设置 → Office 转换**，点「一键配置 MarkItDown 环境」，装到哪个解释器由你当场选。这样离线机器、或已经自己装好的机器，都不会被脚本擅自改动 Python 环境。
>
> 直接双击 `.ps1` 会被「禁止运行脚本」拦下；上面第一行只在当前进程内放开，不改变系统全局策略。

### 方式 4：手动安装（完全不用脚本）

1. 把整个 `dsh-plugin-office-markdown` 目录复制到 `<profile>\node_modules\dsh-plugin-office-markdown`；
2. 编辑 `<profile>\cordis.patch.yml`，在**文件末尾**追加：

```yaml
- insert:
    - id: office-markdown
      name: dsh-plugin-office-markdown
      config:
        enabled: true
```

> 只需追加一份；`cordis.patch.yml` 是顶层 YAML 数组。若脚本已经写过受管块，不要再手写第二份。

### 安装后必须做的一步：重启 DSH

两个原因：

- DSH 会热加载 `cordis.patch.yml` 的配置改动，但**不会重新 import 已经加载过的插件模块**（Node ESM 缓存）。首次安装、以及每次改 `lib/*.js` 之后，都必须重启。
- `dsh.client` 声明（设置页）只在启动时扫描一次，宿主必须重新扫描已启用的条目才会加载客户端半边。

首次重启之后，再改 `lib/client.js`（设置页界面）能被 HMR 热替换，不必再重启；改 `lib/*.js` 的宿主半边仍然要重启。

### 验证安装

- 打开 **设置 → Office 转换**：能看到当前转换器、本机 Python 环境、一键配置 / 一键卸载；如果 DSH 自带运行时里已经有 MarkItDown，会显示「已接管（原本已安装）」。
- 在工作区放一个 `.docx` 或 `.xlsx`，对 DSH 说"读取并总结这个文件"：应先调用 `read_office_as_markdown` 生成 `.md`，再读该 `.md`。
- 或直接要求："用 `read_office_as_markdown` 查看 status"，会列出当前可用的转换器链。

---

## 3. 升级到 v1.2.0

**DSH 没有升级按钮**，已装旧版的话按下面任一条做，然后**重启 DSH**：

1. 在 **设置 → 插件** 里卸载旧版，再用 `github:Z8906/dsh-plugin-office-markdown#v1.2.0` 重装；
2. 或直接覆盖安装目录：`pnpm pack` 出 `.tgz` → 解包 → 把它复制进 `<profile>\node_modules\dsh-plugin-office-markdown`（**覆盖式复制不会删除多余文件**，若旧版有已删除的文件，建议先手工删掉那个目录）。

升级后：

- 由 **1.1.x 生成的旧产物没有标记行**，工具会如实报告「保真度未知」；传 `force: true` 重转一次即可补上 `converter=` / `fidelity=` 标记。
- 旧版的环境记录 `~/.dsh/dsh-plugin-office-markdown.env.json` 继续有效，不需要重装 Python 环境。

---

## 4. 设置页：Office 转换

在 DSH 的 **设置** 里，左侧多一项 **Office 转换**（`settings.section`，order 450；关闭插件后这一项会一起消失）。页面分五块：

| 区块 | 作用 |
| --- | --- |
| **当前转换器** | 一眼看出现在用的是 🟢 **本机 MarkItDown**（高保真）还是 🟡 **内置兜底**（保真度有限），并列出完整转换链 |
| **Python 环境** | 点「检查本机环境」逐个列出候选解释器：路径、来源（DSH 自带 / 系统 PATH）、有没有 `pip`、有没有装 `markitdown`（含版本）、哪个是当前生效的。可用下拉框指定「装到哪一个」。探测是**并发**做的，每个解释器另有独立超时预算，卡死的会标成「⏱ 未响应」而不是拖住页面；结果按 `probeTtlMs` 缓存，旁边有「重新检查」可强制重探 |
| **一键配置 MarkItDown 环境** | 对选中的解释器执行 `pip install "markitdown[all]"`。安装**前**记录 `pip freeze`、安装**后**取差集，把「这次新增了哪些包」写进环境记录。**如果这个解释器已经有 MarkItDown，就跳过安装、直接完成登记。**任务在后台跑，页面实时显示进度日志 |
| **插件配置的环境** | 显示环境记录（哪个解释器、新增 / 登记了哪些包、什么时候、是否有包因被运行时共用而保留），以及「卸载插件配置的环境」按钮 —— 只卸载**记录里属于 MarkItDown 的**那些包 |
| **试转一个文件** | 填一个绝对路径，点「试转」：不进模型、不走缓存，直接在本机跑一遍完整转换链，返回转换器、保真度、体积、行数、tokens、耗时和 500 字预览。产物固定叫 `<文件名>-test.md`，放在源文件旁边（配了 `tmpDir` 就放那里），每次覆盖、不会堆积，也不会被工具误当成缓存结果 |

页面上的按钮走插件自己的 HTTP 路由 `/office-markdown/api/*`：

| 方法 | 路由 | 用途 |
| --- | --- | --- |
| GET | `/api/status` | 当前转换器 + 环境记录 + 后台任务（快） |
| GET | `/api/probe`（`?force=1` 强制重探） | 完整逐解释器探测（慢） |
| GET | `/api/job` | 正在跑的安装 / 卸载任务进度 |
| POST | `/api/convert-test` | 用真实转换链试转一个文件 |
| POST | `/api/env/install` | `pip install "markitdown[all]"` |
| POST | `/api/env/uninstall` | 只卸载本插件登记过的包 |

如果所在 profile 没有 `webServer` 服务（例如纯 CLI），路由不会注册，但工具与技能完全不受影响。

---

## 5. 启用 / 禁用 / 卸载

| 目标 | 做法 |
| --- | --- |
| 临时禁用（等于没装） | DSH 插件管理里关掉 `office-markdown`；或把受管块里 `enabled` 改成 `false` 后重启。**禁用不会卸载任何 Python 包** |
| 在 DSH 里卸载插件（推荐） | DSH **设置 → 插件** 里找到它，点卸载。插件在真正被移除时会**自动**把环境记录里属于它的 Python 包 `pip uninstall` 掉 |
| 彻底卸载（脚本） | `& "<plugin>\install.ps1" -Uninstall` —— 移除受管块、删除 `node_modules` 副本、清理 `package.json` 登记、删除卸载日志，**并按环境记录卸载属于本插件的 Python 包** |
| 卸载但想留着 markitdown | `& "<plugin>\install.ps1" -Uninstall -KeepMarkitdown` |
| 卸载但想留着卸载日志 | `& "<plugin>\install.ps1" -Uninstall -KeepRemovalLog` |
| 彻底卸载（手动） | 删除 `<profile>\node_modules\dsh-plugin-office-markdown` 并删掉受管块。**手工删目录不会清理 Python 包**；想一起清，请改用脚本，或先在设置页点「卸载插件配置的环境」 |

`apply()` 在看到 `config.enabled === false` 时**直接返回、不注册任何东西** —— 工具、技能、`read` 守卫、设置页都不会出现，和没装完全一致。

### 卸载插件时，Python 环境会一起清掉

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

看门狗自身有三重保险：

- **单实例锁**：`~/.dsh/dsh-plugin-office-markdown-watchdog.lock`。重复派发的进程发现锁还在会立刻自我退出（只清掉自己那对临时文件，绝不碰锁）。
- **寿命上限 120 秒**：前 30 秒每 2 秒查一次，之后每 10 秒查一次，超时放弃并留日志。实测 `pnpm remove` 只要约 2 秒，余量很宽。
- **开销近乎为零**：判断「包目录还在不在」只做一次 `stat`，不读任何文件。实测常驻内存约 13 MB、空闲 12 秒内累计 CPU 0.00 ms。

日志写在 `~/.dsh/dsh-plugin-office-markdown-removal.log`：**清理成功只留一行摘要**，失败 / 超时 / 未确认才保留完整转录（见下面「这个插件会留下哪些文件」）。

清理范围严格限定在**环境记录**里：

- 由本插件 `pip install` 进去的包 → 卸载；
- 由「一键配置」**登记**过的、原本就存在的 MarkItDown 及依赖 → 卸载（记录里 `adopted: true`，设置页显示「已接管（原本已安装）」）；
- **DSH 运行时自带的包**（`numpy` / `pandas` / `python-docx` / `python-pptx` / `openpyxl` / `Pillow` / `lxml` / `XlsxWriter` 等，清单取自 `~/.dsh/dsh-runtimes/*/runtime.json` 的 `pythonPackages`）→ 一律保留；
- 被**闭包外**其它组件依赖的包 → 一律保留（页面会显示保留数量）；
- **你自己装的、没登记过的 MarkItDown** → 一个都不会动。

`config.removeEnvOnUninstall: false` 可彻底关掉这个行为；`config.autoAdoptEnv: false` 可关掉「启动时自动登记 DSH 自带运行时里的 MarkItDown」。

---

## 6. 使用

### 工具 `read_office_as_markdown`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `path` | 否 | 文件**或目录**路径（相对工作区或绝对路径）。传目录时按扩展名找出其中的 Office / PDF 文件。`action: "status"` 时可省略 |
| `paths` | 否 | 批量处理：多个文件或目录路径（等价于把数组交给 `path`） |
| `action` | 否 | `auto`（默认）/ `convert`（强制转换）/ `read`（读取已转换结果开头）/ `outline`（只给结构索引，**绝不触发转换**）/ `clean`（清理同一源文件的陈旧产物）/ `status`（查看可用转换器与各 Python 环境） |
| `force` | 否 | `true` 时忽略已有结果重新转换 |
| `preview` | 否 | 返回 Markdown 开头的字符数（默认 0，只返回路径最省 token；上限为 `maxPreviewChars`） |
| `recursive` | 否 | `path` 是目录时是否递归子目录（默认 `false`）；无论是否递归，一次最多展开 200 个文件 |
| `dryRun` | 否 | 仅对 `action: "clean"` 有效：`true`（默认）只报告，传 `false` 才真的删除 |

返回值包含路径、体积、**行数**、token 估算、转换器与保真度，外加一份**结构索引**（章节 / 工作表 / 幻灯片的标题与大致行号），**不会把全文塞进上下文，也绝不会裁剪产物**。同时给出读取策略：先用 `read` 读前 200 行看结构，再用 `grep` 在同一个 `.md` 里定位片段，不要整份读入。

产物第一行会写入一行 HTML 注释，记录它是谁转的（Markdown 渲染时不可见）：

```
<!-- dsh-office-markdown converter=python-module fidelity=high at=2026-10-02T12:31:15.000Z srcbytes=5462 srchash=c7753efa1a3f81d8 -->
```

命中缓存时插件就从这一行读回真实的转换器与保真度，而不是无条件声称「保真度高」。由 1.1.x 生成的旧产物没有这一行，会被如实报告为「保真度未知」，传 `force: true` 重转一次即可。另外，如果缓存里的产物是**内置兜底**转出来的、而这台机器现在已经有 MarkItDown，插件不会默默复用那份低保真结果，而是重新转换一次并说明原因。

批量处理（`paths` 或目录）时逐文件**串行**转换，避免同时拉起一堆解释器；结果按「一行一个文件」汇总，只有单个文件才给详细输出。

传目录时，返回值总会附带一条「目录展开」说明：是否递归、扫到几个文件、挑出几个 Office / PDF、跳过几个非 Office 文件、有哪些子目录没进去 —— 即使只挑出 1 个文件也会说明，免得「只处理了 1 个文件」被误读成「这个文件夹只有 1 个文件」。

对 `.md` / `.txt` / `.csv` / `.json` 等纯文本，工具会直接告知"无需转换，直接 read 最省 token"（`.csv` 如确需 Markdown 表格，可传 `action: 'convert'`）。

### 技能说明

插件同时注册一份运行时技能，要求模型：

> 遇到 .docx、.xlsx、.pptx、.pdf、.csv 等 Office / PDF 文件时，不要直接读原文件，必须先调用 read_office_as_markdown 工具转换成 Markdown，再读取转换后的 .md 文件。转换结果就在源文件旁边（工作区里），按需读取，避免全文注入上下文。

技能里还写明：**需要装 MarkItDown 时，让用户打开 DSH 设置里的「Office 转换」页面去点一键配置，模型不要自己执行 `pip install`。**

### `read` 守卫

默认开启：当模型试图用 `read` 直接读取 `.docx/.xlsx/.pptx/.pdf` 等二进制文件时，守卫会拒绝。**如果这个文件其实已经转换过，守卫会直接把那个 `.md` 的绝对路径交给它**，让下一次 `read` 立刻成功；源文件此后有改动时会说明那是较早的产物。换成别的路径读同一个文件**不能**绕过守卫，正确做法是关闭 `guardReadTool`。纯文本文件不受影响。

---

## 7. 转换器优先级与保真度

按顺序探测，第一个可用的胜出：

| 顺序 | 转换器 | 保真度 | 依赖 |
| --- | --- | --- | --- |
| 1 | `uvx markitdown`（临时运行，无需永久安装） | 高 | 需要 `uv` + 网络（首次） |
| 2 | 本机 `markitdown` 命令 | 高 | 已安装 markitdown |
| 3 | `python -m markitdown` | 高 | Python + markitdown |
| 4 | 内置 **Python** 兜底（`lib/fallback.py`） | 有限 | 任意 Python 3；可选 python-docx / openpyxl / python-pptx / pypdf |
| 5 | 内置 **Node** 兜底（`lib/fallback-node.js`） | 有限 | **无**：只用 Node 内置 `zlib`，不需要 Python，不需要网络 |

第 4、5 级只在前三级全部不可用时才使用，并且结果文件开头会写入 `fidelity=limited` 标记，工具返回里也会说明「保真度有限」。反过来，如果缓存里那份就是兜底产物、而现在这台机器已经有 MarkItDown，插件会重新转换一次把它升级掉。

### 没有 Python、没有网络时怎么办

**仍然可用** —— 一级都不需要装：

- 第 5 级 `fallback-node.js` 随插件打包，直接用 DSH 自带的 Node 在**当前进程内**解析 OOXML（`.docx`/`.xlsx`/`.pptx` 本质是 zip + xml）：内置 `zlib` 解压、正则抽取文字与表格，全程离线、零依赖。
- 支持：`.docx` `.docm` `.xlsx` `.xlsm` `.pptx` `.pptm`。
- 不支持（会给出明确中文提示，而不是静默失败）：`.pdf`、旧版二进制 `.doc` `.xls` `.ppt`、`.msg` `.epub` `.odt` `.ods` `.odp`。这些需要 MarkItDown 或本机 Python 兜底。
- 关于 Python：装了 DSH 的电脑通常已带一个运行时 Python，插件会自动发现 `%USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\python\python.exe`；如果该 Python 里同时装了 `python-docx/openpyxl/python-pptx/pypdf`，第 4 级兜底也能用（PDF 会尝试 pypdf → PyPDF2 → pdfminer，最后还有一个极简流解析）。

### 升级到最高保真度：安装 MarkItDown

第 1~3 级才是真正的 MarkItDown。**任意一级可用后插件会自动切过去，不需要改配置，也不需要重启 DSH**；探测结果有 10 分钟缓存（`probeTtlMs`），想立刻生效就调用一次工具并传 `action:"status"`（强制重探），或在设置页点「重新检查」。

**推荐：在设置页一键配置**

1. 打开 **设置 → Office 转换**；
2. 在「Python 环境」区块点 **检查本机环境**，确认候选列表；
3. 需要的话用下拉框选一个解释器（默认帮你选中第一个「有 pip」的）；
4. 点 **一键配置 MarkItDown 环境**，等进度日志跑完。

装完之后：插件会自动切到 `python -m markitdown`（高保真）；会写下环境记录，「插件配置的环境」区块能看到新增 / 登记了什么，随时可以一键卸载，**在 DSH 里卸载插件时也会自动清掉**；如果那个解释器本来就已经有 MarkItDown，第 4 步会跳过安装、直接登记，显示「已接管（原本已安装）」；**没登记过的 markitdown（例如你在别的 Python 环境里 `pip install` 的）不会被记录，也永远不会被插件卸载。**

**手工安装（等价做法）**

> 手工装的 markitdown **不会被自动登记**。想让插件在卸载时帮你收拾，装完请回设置页点一次「一键配置」完成登记。

```powershell
# 1) DSH 自带的 Python（推荐，插件在 pythonPrefer: auto 下优先命中）
& "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" -m pip install "markitdown[all]"

# 2) 或者系统里的 Python
pip install "markitdown[all]"
```

`markitdown[all]` 约 90 MB：`magika` + `onnxruntime` 负责文件类型识别，`pdfminer.six` / `pdfplumber` 负责 PDF，`mammoth` 负责 docx，`xlrd` 负责旧版 `.xls`，`markdownify` 负责 HTML。

装完自检：

```powershell
& "<上面的 python.exe>" -m markitdown --help
```

- `markitdown.exe` 会落在 `<python>\Scripts\`，**不必加进 PATH** —— 插件走的是 `python -m markitdown`。
- 只装到系统 Python 也能被找到，但插件会先试 DSH 自带的那个；两个都装了则优先用自带的。
- 想「临时用、不永久安装」就装 [uv](https://docs.astral.sh/uv/)：插件会优先走 `uvx --from "markitdown[all]" markitdown`，用完即走。

### 多个 Python 环境：插件会用哪一个

一台机器上通常有三类 Python：**DSH 自带运行时**、**系统 PATH 上的 Python**、以及你在 `pythonPath` 里手动指定的解释器。插件会按顺序对每个候选执行 `-m markitdown --help`，**第一个装了 markitdown 的胜出**。

默认顺序（`pythonPrefer: auto`）：

1. `pythonPath` 指定的解释器
2. `~/.dsh/dsh-runtimes/*/dependencies/python/python.exe`（DSH 自带运行时）
3. `python` → `python3` → `py -3`（系统 PATH）

想看清「到底哪个环境装了 markitdown」，调用一次（**不需要传 `path`**）：

```
read_office_as_markdown({ action: "status" })
```

它会强制重新探测并逐个列出，`✅ 使用中` 就是当前真正在用的那个：

```
🐍 Python 环境（pythonPrefer：auto；按此顺序探测，第一个装了 markitdown 的胜出）
  ✅ 使用中  C:\Users\...\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe   [DSH 自带运行时]
  ❌ 未安装  python   [系统 PATH]  ← D:\path\to\python.exe: No module named markitdown
  ❌ 未安装  python3   [系统 PATH]  ← Python was not found; ... Microsoft Store ...
  ❌ 未安装  py   [系统 PATH]  ← D:\path\to\python.exe: No module named markitdown
```

要固定用某一个，两种办法：

- **精确指定**：`pythonPath: 'D:\path\to\python.exe'` —— 只试这一个，试不通就直接进兜底。
- **只换顺序**：`pythonPrefer: bundled`（只用 DSH 自带）/ `system`（系统 PATH 优先）/ `config`（只用 `pythonPath`）。某种模式无法满足时会自动退回 `auto`，不会让插件失去解释器。

安装建议：**装到 DSH 自带 Python 最省事**（设置页默认也是往它装）；只装到系统 Python 也能被找到，但把 `pythonPrefer` 设为 `system`、或用 `pythonPath` 指过去更稳妥。

---

## 8. 产物与文件

### 转换产物放在哪里

- 位置：**源文件旁边**（同目录），文件名是 `<原名>-<8 位哈希>.md`。
- 哈希由 **绝对路径 + 大小 + 修改时间 + 转换参数** 计算，源文件一变就生成新的 `.md`；源文件没变且 `.md` 还在时直接复用（返回里会写"已有转换结果"），传 `force: true` 强制重转。
- **修改时间变了但内容没变**（`git checkout`、复制、从备份还原）时不会白转一遍：每个产物都记录了源文件的字节数与内容哈希，比对确认内容相同就复用已有 `.md` 并把它重新挂到当前缓存键上 —— 一个源文件只对应一份产物。
- `.md` 归你所有：插件**默认不删**。清理同一源文件的历史产物有两个途径：`action: "clean"`（默认 `dryRun: true`，先看会删什么，确认后传 `dryRun: false`），或把 `pruneStaleArtifacts` 设为 `true`。两者都只认同一个目录下 `<原名>-<8位十六进制>.md` 这种形态的普通文件，绝不递归、绝不动当前那一份，也不会碰你自己写的 `.md`。
- 设置页「试转一个文件」产生的 `<文件名>-test.md` 不参与缓存：名字不符合上面的模式，既不会被当成缓存结果，也不会出现在清理列表里。
- 想让产物集中到某个子目录：把 `tmpDir` 配成相对路径（如 `tmpDir: '.md-out'`）或绝对路径；留空（默认）就是"和源文件放一起"。
- 建议把产物文件名模式加进 `.gitignore`（例如 `*-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f].md`），免得转换结果被提交进仓库。

### 这个插件会留下哪些文件

转换本身是**零残留**的：产物只有源文件旁边那一个 `.md`（试转时是 `<文件名>-test.md`），没有临时目录、没有注册表、没有 sidecar 元数据；插件包目录里不会产生 `__pycache__` / `.pyc`，工作区里也不会出现隐藏目录。

除此之外只有下面几处，都在 `~/.dsh`（Windows 是 `C:\Users\<你>\.dsh`）或 profile 目录下：

| 文件 | 什么时候产生 | 卸载插件时会怎样 |
| --- | --- | --- |
| `<源文件>-<8位哈希>.md` | 每次转换 | **保留**（归你所有，插件不删） |
| `dsh-plugin-office-markdown.env.json` | 点过「一键配置」装 / 登记 MarkItDown 之后 | **自动删除** |
| `dsh-plugin-office-markdown-removal.log` | 每次在 DSH 里卸载本插件时写一段 | 清理成功时只剩一行摘要；失败 / 超时保留完整记录 |
| `<profile>\cordis.patch.yml.bak` | 用 `install.ps1` 写入受管块前 | 保留（不属于插件运行时，确认没问题可自行删除） |
| `~/.dsh/dsh-plugin-office-markdown-watchdog.lock` | 看门狗运行期间（单实例锁） | 看门狗退出时自动删除 |

关于 `removal.log`：卸载插件时，插件的代码会先被 DSH 销毁、包目录过几秒才被删掉，中间若重启一次 harness，宿主里的定时器就全没了 —— 所以插件在销毁前会派一个**脱离 DSH 的进程**去等，确认插件真的被移除后再执行 `pip uninstall`。那个进程的输出被丢弃，每一步都写进这个日志。

**这份日志只在「没清干净」时才需要**，所以它留下什么完全取决于结果：

| 这次卸载的结果 | 日志里留下什么 |
| --- | --- |
| 清理成功（`pip` 退出码 0），或无需清理（没有环境记录 / 记录里没有要负责的包） | 只有一行摘要：`[时间] 卸载完成：清理 N 个包，pip 退出码 0` |
| `pip` 退出码非 0、调用 `pip` 失败、环境记录里没有解释器路径 | **完整转录**（留给排查） |
| 等了 120 秒仍未确认插件被移除 | **完整转录**（留给排查） |

> 失败路径的日志会累积，裁剪发生在看门狗**启动**时：超过 64 KB 就只保留最近约 16 KB。想清空直接删掉这个文件即可；`install.ps1 -Uninstall` 也会顺手删掉它（加 `-KeepRemovalLog` 可保留）。

另外，`pip install` 会往 pip 自己的缓存目录里留 wheel（通常 `%LOCALAPPDATA%\pip\cache`，本机实测约 120 MB）。它属于 pip 而非本插件，卸载本插件不会清它，想清就执行 `pip cache purge`。

---

## 9. 配置项

写在 `cordis.patch.yml` 受管块的 `config:` 下（也可通过 DSH 插件管理的配置界面改）。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | `false` 时完全等价于未安装（工具 / 技能 / 守卫 / 设置页全都不注册） |
| `tmpDir` | `''` | 转换结果目录。**留空 = 与源文件同目录**（默认）；也可填相对工作区的路径（如 `.md-out`）或绝对路径 |
| `converter` | `auto` | `auto` 或指定 `uvx` / `markitdown-cli` / `python-module` / `builtin` / `node-builtin` |
| `pythonPath` | `''` | 指定 Python 解释器绝对路径，命中后**只**试它；留空则自动发现 |
| `pythonPrefer` | `auto` | Python 探测顺序：`auto`（配置 → DSH 自带运行时 → 系统 PATH）/ `bundled`（只用 DSH 自带）/ `system`（系统 PATH 优先）/ `config`（只用 `pythonPath`）。无法满足时自动退回 `auto` |
| `allowUvxDownload` | `true` | 允许 `uvx` 首次下载 markitdown |
| `uvxExtras` | `markitdown[all]` | `uvx --from` 使用的包规格 |
| `fallbackEnabled` | `true` | 允许第 4、5 级内置兜底 |
| `guardReadTool` | `true` | 拦截对二进制 Office 文件的直接 `read` |
| `probeTtlMs` | `600000` | 转换器探测结果缓存时长（毫秒） |
| `timeoutMs` | `300000` | 单个转换子进程超时 |
| `reuseFresh` | `true` | 复用未过期的转换结果 |
| `pruneStaleArtifacts` | `false` | 每次成功转换后顺手清掉**同一源文件**的陈旧产物（只匹配 `<原名>-<8位十六进制>.md`、只删非当前那一份、绝不递归）。默认关闭；也可以随时用 `action: "clean"` 手动清 |
| `maxPreviewChars` | `4000` | `preview` 参数上限 |
| `maxRowsPerSheet` | `400` | 每个工作表 / 表格最多输出行数 |
| `maxTableCols` | `24` | 表格最多输出列数 |
| `maxCellsPerSheet` | `20000` | 每个工作表最多导出单元格数 |
| `registerSkill` | `true` | 是否注册那份技能说明 |
| `registerSettings` | `true` | 是否注册「Office 转换」设置页 |
| `autoAdoptEnv` | `true` | 启动时如果发现 **DSH 自带运行时**的解释器里已经有 MarkItDown，就自动登记它，以便卸载插件时一并清理。用户自己的 Python 不会被自动登记 |
| `removeEnvOnUninstall` | `true` | 在 DSH 里卸载本插件时，是否自动 `pip uninstall` 环境记录里的包。设为 `false` 则只删记录文件、不碰 Python 环境。**这个开关只在真正卸载插件时生效，禁用 / 关闭 / 重启都不受影响** |

---

## 10. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 重启后工具仍不出现 | 看 `<profile>\cordis.patch.yml` 里受管块的 `name` 是否等于 `node_modules` 下的目录名；确认 `node_modules\dsh-plugin-office-markdown\lib\index.js` 存在 |
| 设置里找不到「Office 转换」 | ① 必须**重启过** DSH；② 确认 `lib\client.js` 存在；③ `registerSettings` 是否为 `true`；④ 该 profile 有没有 `webServer`（CLI profile 没有，页面不会出现，工具照常可用） |
| 「插件」页里看不到本插件 | 只有作为 **bundle** 登记进 profile 的包才会出现在这一页（包名同时出现在 `<profile>\package.json` 的 `dsh.profile.bundles` 和 `dependencies` 里）。只往 `cordis.patch.yml` 写受管块的装法，插件能用、设置页也有，但「插件」页不列出它。改用方式 1 或 `-RegisterBundle` 重装即可 |
| 设置页能打开但所有区块都报错 | 客户端走 `/office-markdown/api/*`。说明宿主半边没激活，或 `webServer` 路由没注册成功；看 DSH 启动日志里 `office-markdown` 这一条的状态 |
| 改了 `lib/*.js` 没生效 | DSH 不会重新 import 已缓存的插件模块，**必须重启 DSH**。只改 `lib/client.js` 由 HMR 热替换，刷新页面即可 |
| 提示 "spawn uvx ENOENT" / "spawn markitdown ENOENT" | 本机没有 `uv`，`markitdown` 也不在 PATH。**两者都不是必需的**：只要某个 Python 装了 markitdown，就会命中第 3 级 |
| 装了 markitdown 但插件仍走兜底 | 多半是装到了别的 Python。先传 `action:"status"`（**无需 `path`**）看 🐍 明细里哪个环境是 `✅ 使用中`；再确认那个解释器能跑 `-m markitdown --help`。要固定就用 `pythonPath`，要换顺序改 `pythonPrefer`。探测结果有 10 分钟缓存，`status` 会强制重探 |
| 结果开头有"非 MarkItDown … 保真度有限" | 说明走的是第 4/5 级兜底。按第 7 节装 `markitdown[all]` 即可提升保真度 |
| PDF 转换失败 | Node 兜底不支持 PDF；需要 MarkItDown 或带 pypdf 的 Python 兜底 |
| 设置页一键配置很慢 / 失败 | `markitdown[all]` 约 90 MB，需要联网。失败时页面任务日志里有 pip 的最后几行错误；也可手动重试：`& "<python>" -m pip install "markitdown[all]"` |
| 想彻底关闭 | 受管块 `enabled: false` 后重启，或 DSH 插件管理里禁用 |
| 从 Releases 下的 `.tgz` 里找不到 `install.ps1` | 这是正常的：`.tgz` 是 npm 包结构，只含 `lib/`、`cordis.patch.yml`、`README.md`、`package.json`、`LICENSE`。**要脚本请改用方式 3**：同一页的 `.zip` 源码快照里有 `install.ps1`（不必装 git），也可以 `git clone` |
| `install.ps1` 报"禁止运行脚本" | 先执行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force` |
| `install.ps1` 中文乱码 / 语法报错 | 脚本以 **UTF-8 带 BOM** 保存（`README.md` 等其它文件是无 BOM）—— Windows PowerShell 5.1 只有见到 BOM 才会按 UTF-8 解码，否则按 ANSI 读，中文提示会全部乱码。**请勿用会去掉 BOM 的编辑器另存它** |
| `install.ps1` 说"没有找到任何 Python 解释器" | 目标电脑还没装 Python。插件仍能用（走 Node 兜底）；装上 Python 后重跑 `& .\install.ps1 -SkipCopy` 就能看到它 |
| 卸载后 markitdown 还在 | 只有**登记过**的包才会被卸载：用设置页「一键配置」装 / 登记的，以及 DSH 自带运行时里被自动登记的那一份。你在**别的** Python 环境里自己 `pip install` 的、或登记后又手工装到别处的，插件都不会去动。要干净卸载就手工 `pip uninstall markitdown`；如果连环境记录都没写下来，说明当时登记失败了，设置页会有一行「登记失败」的日志 |
| 卸载插件后 Python 包没被清掉 | 先看 `~/.dsh/dsh-plugin-office-markdown-removal.log`。① profile 的 `package.json` 里 `dsh.profile.bundles` 仍列着本插件 → 插件认为你只是禁用了它；② 120 秒内包目录一直没消失 → 看门狗超时放弃，改用 `install.ps1 -Uninstall` 照样能清；③ 检查 `removeEnvOnUninstall` 是否被改成了 `false` |
| 转换出来的 `.md` 越来越多 | 用 `read_office_as_markdown({ path: "报表.xlsx", action: "clean" })` 先看会删哪些（默认 `dryRun`），确认后传 `dryRun: false`；或把 `pruneStaleArtifacts` 设为 `true`。源文件内容没变、只是修改时间变了时，插件会比对内容哈希后复用旧产物，不再写重复文件 |
| 返回值里保真度显示「未知」 | 那份 `.md` 是 1.1.x 生成的，第一行没有转换器标记。传 `force: true` 重转一次就会补上 |
| 转换出来的 `.md` 会自己消失吗 | **不会，这是设计如此。** 只有你显式用 `action: "clean"`（且传了 `dryRun: false`）或把 `pruneStaleArtifacts` 设为 `true`，才会删除 |

---

## 11. FAQ

**为什么 v1.0.0 无法正常使用？**
该版本确认无法正常使用，已被 v1.1.0 及之后的版本取代。它还有两个结构性缺陷：① DSH 数据目录被写死为 `~/.dsh`，profile 或数据目录不在默认位置时会找错环境记录与日志；② 没有独立的卸载看门狗，卸载过程中重启一次 DSH，登记的 Python 包就永远清不掉。**请直接安装 v1.2.0。**

**为什么 v1.0.0 / v1.1.0 / v1.1.1 的日期都是 2026-10-01？**
因为这三个 tag 与 Release 是在那天一次性补建的（tag 时间同为 `20:58:23`，Release 发布时间相隔 2 秒）。项目实际开发自 2026-08 起；补档不等于发布。

**这个插件会自己升级吗？**
不会。DSH 没有升级按钮，也不会自动升级；换版本请重装后重启（见第 3 节）。

**需要联网吗？**
不需要。只有三种情况会用到网络：首次 `uvx` 下载 MarkItDown、设置页一键配置 `pip install`、以及你自己去 clone 仓库。

**会把我的 `.md` 删掉吗？**
不会。插件默认只创建文件、从不主动删除；`action: "clean"` 默认也是 `dryRun`（只报告）。它连自己写过的 `.md` 都不删，更不会碰同目录里其它文件。

**会不会动我自己装的 MarkItDown？**
不会。只有写进环境记录的包（本插件装的、或经你确认登记的）才会被卸载；没登记过的一个都不动。

**要写进 DSH 的「插件市场」吗？**
`github:Z8906/dsh-plugin-office-markdown` 已经是完整的 bundle 安装，功能和从市场里装的一模一样，**一键安装不需要上架**。想让它在市场里能被搜到，需要往市场的目录清单（[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com/plugins.json)）提一个条目 —— 那是人工维护的清单；发布到 npm 是另一条独立的路。此外，用 `github:` 形式装进去的插件，DSH 市场**能检测到更新**（拿 lockfile 里的 commit 与仓库远程 HEAD 比对），但不会自动升级。

---

## 12. 包内文件与兼容性

```
dsh-plugin-office-markdown/
├── package.json          # dsh.bundle.patch → cordis.patch.yml；dsh.client → lib/client.js
├── cordis.patch.yml      # 供 bundle 方式安装时使用的 insert 条目
├── README.md             # 本文件
├── LICENSE               # MIT
├── install.ps1           # 安装 / 卸载脚本（不进 .tgz；Releases 的 .zip 源码快照里有）
├── CHANGELOG.md          # 版本更新日志（不进 .tgz）
├── .github/workflows/    # CI（语法 / 版本号 / 打包结构）与发布（推 v* tag 自动建 Release，不进 .tgz）
└── lib/                  # 全部随 .tgz 发布（9 个文件）
    ├── index.js            # 工具 + 技能 + read 守卫的注册（host half）
    ├── convert.js          # 类型判定、转换器探测、转换链（纯 Node 标准库）
    ├── env.js              # Python 环境探测 / 一键配置 / 登记已有环境 / 按记录卸载（host half）
    ├── paths.js            # DSH 数据目录解析（~/.dsh、profiles、runtimes），带环境变量回退
    ├── removal-watchdog.js # 卸载看门狗：脱离宿主轮询确认「已被移除」，确认后清 Python 环境
    ├── settings-api.js     # /office-markdown/api/* 路由 + 后台任务状态（host half）
    ├── client.js           # 「Office 转换」设置页（client half，手写、无构建步骤）
    ├── fallback-node.js    # 第 5 级：纯 Node OOXML 兜底（无 Python / 无网络）
    └── fallback.py         # 第 4 级：Python 兜底（docx/xlsx/pptx/pdf/csv/rtf/json…）
```

- Node：仅使用内置模块（`fs`/`path`/`os`/`zlib`/`crypto`/`child_process`/`string_decoder`），**没有任何 npm 依赖**，不需要 `npm install`。
- Python 兜底：只用标准库 + 可选 `python-docx` / `openpyxl` / `python-pptx` / `pypdf`。
- 除 `@deepseek-ai/dsh-tools`（由 DSH 自身提供，用于 `defineTool`）外不 import 任何宿主包。
- `apply()` 的全部注册都包在 `ctx.effect(...)` 里，禁用或卸载时会被干净回收；`webServer` 是可选服务，通过 `ctx.inject(['webServer'], ...)` 注册路由 —— CLI profile 缺这个服务时，只有设置页不出现，工具与技能照常工作。
- `client.js` 是手写的 `window.__ModuleLoader__.load({...})` 模块，只用 `require("react")`，不依赖任何 DSH 内部 UI 包，也不依赖任何 CSS 类（样式全内联，明暗主题都能用）。
- **`.tgz` 内容**由 `package.json` 的 `files` 白名单（`lib`、`cordis.patch.yml`、`README.md`）加 npm 自动包含的 `package.json` / `LICENSE` 决定；`install.ps1`、`CHANGELOG.md`、`.github/` 都**不在**包内。
- 卸载时的环境清理走 `ctx.effect(() => () => scheduleRemovalCleanup(...))`：先按第 5 节的判定顺序区分「被卸载」和「被禁用 / 关闭 / 重启」，只有确认是被卸载时才通过 `lib/removal-watchdog.js` 派发一个**脱离宿主的 Python 进程**（`detached` + `unref`，不拖住宿主退出），由它轮询确认后再执行 `uninstallMarkitdown()`。看门狗带单实例锁与 120 秒寿命上限。
- `lib/paths.js` 集中解析 DSH 数据目录，三级回退：`ctx.get('profileContext').dir` 反推（`<home>/profiles/<name>` → `<home>`）→ 环境变量 `DSH_HOME` → `~/.dsh`。插件从不引用 DSH 的**安装**目录，换机器、换安装路径都不受影响。

---

## 13. 开发与贡献

本项目**主要由 DeepSeek 开发**。

- 想改代码：fork 或 `git clone`，改完 `git commit && git push`；别人重新 clone 下来跑 `install.ps1` 即可安装。
- 改了 `lib/*.js` 必须重启 DSH 才生效；改了 `lib/client.js` 可热替换。
- 改了 `lib/` 之后要发布，记得先把 `package.json` 的 `version` 升一位（pnpm 按「路径 + 版本号」缓存 `file:` 依赖）。
- 仓库的 CI 会做：`node --check` 语法检查、tag 与 `package.json` 版本号一致性、`npm pack` 后确认 `.tgz` 顶层目录是 `package/` 且关键文件齐全。
- 发布：推 `v*` tag 时 `.github/workflows/release.yml` 会自动创建 Release 并上传 `.tgz`。

仓库里的 `.gitignore` 已排除 `node_modules/`、`__pycache__/`、`*.pyc`、`.dsh-tmp/`、`.md-out/`、`*.bak`、`*.bak-*`、`*.tgz`、`*.zip`。转换产物（`<原名>-<8位十六进制>.md`）不在其中，需要的话请自行追加。

## 14. 许可证

[MIT](LICENSE) © 2026 dsh-plugin-office-markdown contributors
