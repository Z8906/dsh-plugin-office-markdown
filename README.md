# dsh-plugin-office-markdown

让 DeepSeek Harness（DSH）在读取 Office / PDF 文件时**先自动转成 Markdown 再读**，用路径代替全文注入上下文，从而大幅节省 token。

- 转换在**本地**完成：不联网、不改原文件、不消耗 API 额度。
- 转换结果是一个 `.md`，直接写在**源文件旁边**（同目录）；上下文里只留路径与体积 / token 估算。
- 注册一个工具 `read_office_as_markdown`、一份运行时技能说明，以及一个可选的 `read` 守卫（拦住直接读取二进制 Office 文件的行为）。
- **自带设置页面**：DSH 设置 → **Office 转换**，可以检查本机 Python 环境、一键配置 / 一键卸载 MarkItDown。安装脚本**不会**替你装任何 Python 包，装不装由你在页面里决定。
- **卸载干净**：在 DSH 里移除这个插件时，它会把自己安装 / 登记过的 MarkItDown 及依赖一并 `pip uninstall`，DSH 运行时自带的包和你自己的包一个都不动。**禁用、关闭、重启都不会触发卸载。**
- **零残留**：除了那个 `.md`，插件不写任何临时目录、登记表或缓存元数据。`.md` 归你所有，想删就删。

```
docx / xlsx / pptx / pdf  ──▶  MarkItDown（或内置兜底转换器）  ──▶  源文件旁边的 xxx.md  ──▶  按需 read
        36 KB 的 .docx  →  约 0.5 KB 的 .md（≈115 tokens），原文件一动不动
```

---

## 1. 在新电脑上安装

### 最快：在 DSH 的安装框里填一行

打开 DSH 的 **设置 → 插件 → 安装**，填入下面这行，回车：

```
github:Z8906/dsh-plugin-office-markdown#v1.1.1
```

它会作为 bundle 装进 profile —— **设置 → 插件** 里能看到它、也能一键卸载。装完**重启 DSH**。

- 想去掉版本锁定、跟最新主干：`github:Z8906/dsh-plugin-office-markdown`
- 想装别的历史版本：把 `#v1.1.1` 换成 `#v1.1.0` 或 `#v1.0.0`
- 这条路**要求目标电脑装了 git**（DSH 安装前会先跑一次 `git ls-remote` 预检），并且仓库是公开的 —— 本仓库两条都满足。
- 目标电脑**没有 git**？用下面「从打包好的 zip 安装」的三种方式，或者从 [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) 下载 `.tgz`，在安装框里填它的**绝对路径**。

---

### 从打包好的 zip 安装

把 **`dsh-plugin-office-markdown-v1.1.1.zip`** 拷到目标电脑，解压得到 `dsh-plugin-office-markdown\` 目录，然后按下面的方式安装。

> **先选对安装方式。** 想让插件出现在 DSH 的 **设置 → 插件** 页面里、并且能在那儿**点一下卸载**，就得用 **方式 A** 把它作为 bundle 装进 profile。方式 B / C 只是往 `cordis.patch.yml` 写一段配置 —— 工具、技能、守卫、设置页全都有，但「插件」页不会列出它，因为那一页的数据源只包含 profile 里登记过的 bundle。

### 方式 A：作为 bundle 安装（推荐 —— 「插件」页能看到、能一键卸载）

需要一个 tarball：`dsh-plugin-office-markdown-1.1.1.tgz`（发布包里自带，也可以从 [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) 下载）。

最省事的做法是让 DSH 自己装：

1. 打开 **设置 → 插件**，用安装入口选择这个 `.tgz`（或填它的绝对路径）；
2. DSH 会把它写进 `<profile>\package.json` 的 `dsh.profile.bundles` 与 `dependencies`（`file:` 指向该 tarball），并自动跑一遍 `pnpm install`；
3. 重启 DSH。之后 **设置 → 插件** 里就会列出 `dsh-plugin-office-markdown`，带一个卸载按钮。

不想用界面也行，等价的手工做法是：把 tarball 放到固定位置（例如 `%USERPROFILE%\.dsh\local-packages\`），在 `<profile>\package.json` 里改两处，然后在 `<profile>` 目录下执行 `pnpm install`：

```json
{
  "dsh": { "profile": { "bundles": [ "……", "dsh-plugin-office-markdown" ] } },
  "dependencies": {
    "……": "……",
    "dsh-plugin-office-markdown": "file:../../local-packages/dsh-plugin-office-markdown-1.1.1.tgz"
  }
}
```

> 这样装出来的副本是**真实目录**，不是指向源码的符号链接。**改了源码必须重新打包 + 重装才会生效**；而且 pnpm 是按「路径 + 版本号」缓存 `file:` 依赖的 —— 内容变了但版本号没变时它会直接复用缓存（安装输出里会写 `reused`），你改了 `lib/` 也不会进到 profile 里。所以**每次改完 `lib/` 都要先把 `package.json` 的 `version` 升一位**，再重新打包、复制、重装。

### 方式 B：一键脚本（默认只往 `cordis.patch.yml` 写受管块）

> 这种方式**不会**让插件出现在「插件」页；除此之外功能与方式 A 完全一致。适合不想动 `package.json`、不想跑 pnpm 的场景。
>
> **想要「插件」页的卸载按钮，又不想手工装**：加上 `-RegisterBundle`，脚本会替你把方式 A 做完整 —— 打成 tarball 放进 `<DSH 数据目录>\local-packages\`、在 profile `package.json` 里同时登记 `dsh.profile.bundles` 与 `dependencies` 的 `file:` 指向、用 DSH 自带的 pnpm 跑一次 `install`，最后**移除**它先前写的 `cordis.patch.yml` 受管块（bundle 自带一份，留着会被加载两次）。
>
> ```powershell
> & "<解压路径>\dsh-plugin-office-markdown\install.ps1" -RegisterBundle
> ```

打开 **Windows PowerShell**（不需要管理员权限），执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& "<解压路径>\dsh-plugin-office-markdown\install.ps1"
```

脚本只做三件事：

1. 把插件复制到 `<profile>\node_modules\dsh-plugin-office-markdown`；
2. **只看不装**：逐个探测本机的 Python 解释器（DSH 自带运行时 → 系统 PATH → `py -3`），打印每个有没有 `pip`、有没有装 `markitdown`，并告诉你重启后插件会实际用哪一个；
3. 在 `<profile>\cordis.patch.yml` 末尾写入受管块（`# >>> dsh-plugin-office-markdown` … `# <<< dsh-plugin-office-markdown`）。改文件前会备份成 `cordis.patch.yml.bak`（**固定文件名，每次覆盖，不会累积一堆时间戳备份**）。

> **脚本不会自动 `pip install` 任何东西。** 要装 MarkItDown，重启 DSH 后打开 **设置 → Office 转换**，点「一键配置 MarkItDown 环境」，装到哪个解释器由你当场选。这样离线机器、或已经自己装好的机器，都不会被脚本擅自改动 Python 环境。

常用参数：

```powershell
# 完全不调用任何 Python（离线安装 / 只想复制文件）
& "<解压路径>\dsh-plugin-office-markdown\install.ps1" -SkipEnv

# 装上但先禁用（等价于没装，工具 / 技能 / 守卫 / 设置页都不会出现）
& "<解压路径>\dsh-plugin-office-markdown\install.ps1" -Disabled
```

`<profile>` 默认是 `%USERPROFILE%\.dsh\profiles\desktop`。若目标电脑的 profile 名不同：

```powershell
& "<解压路径>\dsh-plugin-office-markdown\install.ps1" -ProfileDir "C:\Users\你\.dsh\profiles\<你的 profile>"
```

> 直接双击 `.ps1` 或不经 `Set-ExecutionPolicy` 调用会被“禁止运行脚本”拦下；上面的第一行只在当前进程内放开，不改变系统全局策略。

### 方式 C：手动安装（完全不用脚本）

1. 把整个 `dsh-plugin-office-markdown` 目录复制到：
   `<profile>\node_modules\dsh-plugin-office-markdown`
2. 编辑 `<profile>\cordis.patch.yml`，在**文件末尾**追加：

```yaml
- insert:
    - id: office-markdown
      name: dsh-plugin-office-markdown
      config:
        enabled: true
```

> 只需追加一份；`cordis.patch.yml` 是顶层 YAML 数组。若脚本已经写过一个受管块，不要再手写第二份。

### 方式 D：从 GitHub 克隆（想跟版本 / 自己改）

```powershell
git clone https://github.com/Z8906/dsh-plugin-office-markdown.git
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& ".\dsh-plugin-office-markdown\install.ps1"
```

仓库里已经准备好 `.gitignore`（排除 `node_modules/`、`__pycache__/`、`.md-out/`、`*.bak`、`*.bak-*`）和 MIT `LICENSE`。想自己改：fork 一份或直接 clone，改完 `git commit && git push` 就行；别人重新 clone 下来跑上面两条命令即可安装。

> **关于「插件市场」**：想让它在 DSH 市场里能被**搜到**，需要往市场的目录清单（[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com/plugins.json)）提一个条目 —— 那是人工维护的清单；发布到 npm 是另一条独立的路。**但「一键安装」本身不需要上架**：上面的 `github:Z8906/dsh-plugin-office-markdown` 就是完整的 bundle 安装，功能和从市场里装的一模一样。
>
> 附带一点：用 `github:` 形式装进去的插件，市场**能检测到更新**（拿 lockfile 里的 commit 和仓库远程 HEAD 比对），只是不会自动升级，得你点一下。

### 安装后必须做的一步

**重启 DeepSeek Harness。**

两个原因：

- DSH 会热加载 `cordis.patch.yml` 的配置改动，但**不会重新 import 已经加载过的插件模块**（Node ESM 缓存）。所以首次安装、以及之后每次修改 `lib/*.js` 之后，都需要重启 DSH 才会生效。
- `dsh.client` 声明（设置页）只在启动时扫描一次：宿主必须重新扫描已启用的条目才会加载客户端半边。这一次性的扫描同样只在启动时做。

首次重启之后，再改 `lib/client.js`（设置页界面）就能被 HMR 热替换，不必再重启；改 `lib/*.js` 的宿主半边仍然要重启。

### 验证安装

重启后：

- 打开 **设置 → Office 转换** —— 能看到当前转换器、本机 Python 环境、一键配置 / 一键卸载；如果 DSH 自带运行时里已经有 MarkItDown，页面会显示「已接管（原本已安装）」；
- 在工作区放一个 `.docx` 或 `.xlsx`，对 DSH 说“读取并总结这个文件” —— 应先调用 `read_office_as_markdown` 生成 `.md`，再读该 `.md`；
- 或直接要求：“用 `read_office_as_markdown` 查看 status” —— 会列出当前可用的转换器链。

---

## 2. 设置页面：Office 转换

在 DSH 的 **设置** 里，左侧多一项 **Office 转换**（`settings.section`，order 450；关闭插件后这一项会一起消失）。页面分四块：

| 区块 | 作用 |
| --- | --- |
| **当前转换器** | 一眼看出现在用的是 🟢 **本机 MarkItDown**（高保真）还是 🟡 **内置兜底**（保真度有限），并列出完整转换链 |
| **Python 环境** | 点「检查本机环境」逐个列出候选解释器：路径、来源（DSH 自带 / 系统 PATH）、有没有 `pip`、有没有装 `markitdown`（含版本）、哪个是当前生效的。可用下拉框指定「装到哪一个」 |
| **一键配置 MarkItDown 环境** | 对选中的解释器执行 `pip install "markitdown[all]"`。安装**前**记录 `pip freeze`，安装**后**取差集，把「这次新增了哪些包」写进环境记录。**如果这个解释器已经有了 MarkItDown，就跳过安装，直接完成登记。**任务在后台跑，页面实时显示进度日志 |
| **插件配置的环境** | 显示环境记录（哪个解释器、新增/登记了哪些包、什么时候、是否有包因被运行时共用而保留），以及「卸载插件配置的环境」按钮 —— 只卸载**记录里属于 MarkItDown 的**那些包 |

页面上所有按钮走的是插件自己的 HTTP 路由 `/office-markdown/api/*`（`GET /api/status`、`GET /api/probe`、`GET /api/job`、`POST /api/env/install`、`POST /api/env/uninstall`）。如果所在的 profile 没有 `webServer` 服务（例如纯 CLI），路由不会注册，但工具与技能完全不受影响。

---

## 3. 启用 / 禁用 / 卸载

| 目标 | 做法 |
| --- | --- |
| 临时禁用（等于没装） | DSH 插件管理里关掉 `office-markdown`；或把受管块里 `enabled` 改成 `false` 后重启。**禁用不会卸载任何 Python 包** |
| 在 DSH 里卸载插件（推荐） | DSH **设置 → 插件** 里找到 `dsh-plugin-office-markdown`，点卸载。插件在真正被移除时会**自动**把环境记录里属于它的 Python 包 `pip uninstall` 掉 |
| 彻底卸载（脚本） | `& "<plugin>\install.ps1" -Uninstall` —— 移除受管块、删除 `node_modules` 副本、清理 `package.json` 登记，**并按环境记录把属于本插件的 Python 包 `pip uninstall` 掉** |
| 卸载但想留着 markitdown | `& "<plugin>\install.ps1" -Uninstall -KeepMarkitdown` |
| 彻底卸载（手动） | 删除 `<profile>\node_modules\dsh-plugin-office-markdown`，并删掉 `cordis.patch.yml` 里的受管块。**手工删目录时，如果你想让 markitdown 也一起走，请改用上面的脚本方式**，或先在设置页点「卸载插件配置的环境」 |

关闭时的行为：`apply()` 在看到 `config.enabled === false` 时**直接返回，不注册任何东西** —— 工具、技能、`read` 守卫、设置页都不会出现，和没安装这个包完全一致。

### 卸载插件时，Python 环境会一起清掉

这是**只在卸载时**发生的行为，关闭 / 禁用 / 重启都不会触发。

DSH 没有给第三方插件留卸载钩子，而 fiber 被释放这件事在**禁用、关闭、重启、热重载**时同样会发生 —— 所以插件必须先判断「这一次到底是不是正在被卸载」，只有确认是，才动手。

判定顺序（任一条不满足就直接结束，**不启动任何进程**）：

1. `removeEnvOnUninstall` 是 `false` → 什么都不做；
2. 没有环境记录 → 什么都不做；
3. 记录里没有登记过任何包 → 什么都不做；
4. 包目录 `…/node_modules/dsh-plugin-office-markdown/lib/index.js` 已经消失，**且** profile 配置里也不再提到它 → 判定为「已被移除」，**当场直接清理**（连进程都不派发）；
5. **否则，如果 profile 的 `package.json` 里 `dsh.profile.bundles` 仍然列着本插件 → 判定为「只是被禁用 / 关闭 / 重启」，到此结束，不派发任何东西。**
6. 只有「包目录还在、但 `bundles` 里已经没有它」这一种情况 —— DSH 的卸载流程正好如此：先把 bundle 从 `bundles` 摘掉并 reload，几秒后才删目录 —— 才派发一个**脱离宿主的看门狗进程**，由它轮询等待包目录真正消失，确认后再清理。

所以：**平时关闭 / 重启 DSH 不会有任何常驻进程，也不会有任何 Python 包被卸。**

看门狗自身还有三重保险：

- **单实例锁**：`~/.dsh/dsh-plugin-office-markdown-watchdog.lock`。重复派发的进程发现锁还在，会立刻自我退出（只清掉自己那对临时文件，绝不碰锁）。
- **寿命上限 120 秒**：前 30 秒每 2 秒查一次，之后每 10 秒查一次，超时就放弃并留日志。实测 `pnpm remove` 只要约 2 秒，所以 120 秒是很宽的余量。
- **开销近乎为零**：判断「包目录还在不在」只做一次 `stat`，不读任何文件。实测常驻内存约 13 MB、空闲 12 秒内累计 CPU 0.00 ms（低于计时精度）。

日志写在 `~/.dsh/dsh-plugin-office-markdown-removal.log`，事后可以查它做了什么、以及为什么没做。

清理范围严格限定在**环境记录**里：

- 由本插件 `pip install` 进去的包 → 卸载；
- 由「一键配置」**登记**过的、原本就存在的 MarkItDown 及依赖 → 卸载（记录里 `adopted: true`，设置页显示「已接管（原本已安装）」）；
- **DSH 运行时自带的包**（`numpy` / `pandas` / `python-docx` / `python-pptx` / `openpyxl` / `Pillow` / `lxml` / `XlsxWriter` 等，清单取自 `~/.dsh/dsh-runtimes/*/runtime.json` 的 `pythonPackages`）→ 一律保留；
- 被**闭包外**的其它组件依赖的包 → 一律保留（页面会显示保留数量）；
- **你自己装的、没登记过的 MarkItDown** → 一个都不会动。

`config.removeEnvOnUninstall: false` 可以彻底关掉这个行为；`config.autoAdoptEnv: false` 可以关掉「启动时自动登记 DSH 自带运行时里的 MarkItDown」。

### 关于“不留垃圾”

插件运行时的全部产物只有一个文件：**转换出来的 `.md`，就写在源文件旁边**。没有临时目录、没有登记表、没有缓存元数据，所以也没有“清理临时文件”这件事 —— 那个 `.md` 归你所有，什么时候删、删不删都由你决定。

| 产物 | 位置 | 说明 |
| --- | --- | --- |
| 转换出来的 `.md` | **源文件所在目录**（与源文件同名，后缀换 `.md`） | 插件唯一的产物。插件自己不会删它，也不需要删 |
| 环境记录 | `%USERPROFILE%\.dsh\dsh-plugin-office-markdown.env.json` | 只在**用设置页配置/登记过环境，或 DSH 自带运行时里已经有 MarkItDown 被自动登记**时才存在。点「卸载插件配置的环境」、卸载插件、或 `-Uninstall` / `-Uninstall -KeepMarkitdown` 时删除 |
| `cordis.patch.yml` 备份 | `<profile>\cordis.patch.yml.bak` | 固定文件名（每次覆盖，**不会随安装次数累积**）；卸载脚本不动它，确认没问题后可自行删除 |

安全边界：插件只**创建**文件，从不批量删除 —— 它连自己写过的 `.md` 都不会去删，更不会碰同目录里任何别的文件。

---

## 4. 使用

### 工具 `read_office_as_markdown`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `path` | 否 | 要处理的文件路径（相对工作区或绝对路径）。`action: "status"` 时可省略 |
| `action` | 否 | `auto`（默认，自动判断类型）/ `convert`（强制转换）/ `read`（读取已转换结果开头）/ `status`（查看可用转换器，并逐个列出每个 Python 环境有没有 markitdown） |
| `force` | 否 | `true` 时忽略已有转换结果，重新转换 |
| `preview` | 否 | 返回 Markdown 开头的字符数（默认 0，只返回路径，最省 token） |

返回值只包含路径、体积、token 估算、转换器与保真度提示，**不会把全文塞进上下文**。模型随后用 `read` 按需读取，建议先读前 100~200 行确认结构，再用 `grep` 定位片段。

对 `.md` / `.txt` / `.csv` / `.json` 等纯文本，工具会直接告知“无需转换，直接 read 最省 token”（`.csv` 如确需 Markdown 表格，可传 `action: 'convert'`）。

### 技能说明

插件同时注册一份运行时技能，内容要求模型：

> 遇到 .docx、.xlsx、.pptx、.pdf、.csv 等 Office / PDF 文件时，不要直接读原文件，必须先调用 read_office_as_markdown 工具转换成 Markdown，再读取转换后的 .md 文件。转换结果就在源文件旁边（工作区里），按需读取，避免全文注入上下文。

技能里还写明：**需要装 MarkItDown 时，让用户打开 DSH 设置里的「Office 转换」页面去点一键配置，模型不要自己执行 `pip install`。**

### `read` 守卫

默认开启：当模型试图用 `read` 直接读取 `.docx/.xlsx/.pptx/.pdf` 等二进制文件时，守卫会拒绝并提示改用 `read_office_as_markdown`。纯文本文件不受影响。设 `guardReadTool: false` 可关闭。

---

## 5. 转换器优先级与保真度

按顺序探测，第一个可用的胜出：

| 顺序 | 转换器 | 保真度 | 依赖 |
| --- | --- | --- | --- |
| 1 | `uvx markitdown`（临时运行，无需永久安装） | 高 | 需要 `uv` + 网络（首次） |
| 2 | 本机 `markitdown` 命令 | 高 | 已安装 markitdown |
| 3 | `python -m markitdown` | 高 | Python + markitdown |
| 4 | 内置 **Python** 兜底（`lib/fallback.py`） | 有限 | 任意 Python 3；可选 python-docx / openpyxl / python-pptx / pypdf |
| 5 | 内置 **Node** 兜底（`lib/fallback-node.js`） | 有限 | **无**：只用 Node 内置 `zlib`，不需要 Python，不需要网络 |

第 4、5 级都只在前三级全部不可用时才使用，并且结果文件开头会写明显标注，工具返回里也会说明“保真度有限”，不会假装是高保真转换。

### 没有 Python、没有网络时怎么办

**仍然可用** —— 一级都不需要装：

- 第 5 级 `fallback-node.js` 随插件打包，直接用 DSH 自带的 Node 在**当前进程内**解析 OOXML（`.docx`/`.xlsx`/`.pptx` 本质是 zip + xml）：内置 `zlib` 解压、正则抽取文字与表格，全程离线、零依赖。
- 支持：`.docx` `.docm` `.xlsx` `.xlsm` `.pptx` `.pptm`。
- 不支持（会给出明确中文提示，而不是静默失败）：`.pdf`、旧版二进制 `.doc` `.xls` `.ppt`、`.msg` `.epub` `.odt` `.ods` `.odp`。这些需要 MarkItDown 或本机 Python 兜底。
- 关于 Python：装了 DSH 的电脑通常已经带一个运行时 Python，插件会自动发现 `%USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\python\python.exe`；如果该 Python 里同时装了 `python-docx/openpyxl/python-pptx/pypdf`，第 4 级兜底也能用（PDF 会尝试 pypdf → PyPDF2 → pdfminer，最后还有一个极简流解析）。

### 升级到最高保真度：安装 MarkItDown

第 1~3 级才是真正的 MarkItDown。**任意一级可用后插件会自动切过去，不需要改配置，也不需要重启 DSH**；探测结果有 10 分钟缓存，想立刻生效就在设置页点「检查本机环境」，或调用一次工具并传 `action:"status"`（两者都会强制重新探测）。

#### 推荐：在设置页一键配置

1. 打开 **设置 → Office 转换**；
2. 在「Python 环境」区块点 **检查本机环境**，确认候选列表；
3. 需要的话用下拉框选一个解释器（默认帮你选中第一个「有 pip」的）；
4. 点 **一键配置 MarkItDown 环境**，等进度日志跑完。

装完之后：

- 插件会自动切到 `python -m markitdown`（高保真），页面上「当前转换器」会变成 🟢 本机 MarkItDown；
- 插件会写下环境记录，页面上的「插件配置的环境」区块能看到新增/登记了什么，随时可以一键卸载，**在 DSH 里卸载插件时也会自动清掉**；
- 如果那个解释器**本来就已经有** MarkItDown，第 4 步会跳过安装、直接登记，设置页显示「已接管（原本已安装）」；
- **没登记过的 markitdown（例如你在别的 Python 环境里 `pip install` 的）不会被记录，也永远不会被插件卸载。**

#### 手工安装（等价做法）

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

- `markitdown.exe` 会落在 `<python>\Scripts\`，**不必加进 PATH** —— 插件走的是 `python -m markitdown`，不依赖 PATH。
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
- **只换顺序**：`pythonPrefer: bundled`（只用 DSH 自带）/ `system`（系统 PATH 优先于自带）/ `config`（只用 `pythonPath`）。`auto` 是默认。某种模式无法满足时（例如 `config` 但没填 `pythonPath`）会自动退回 `auto`，不会让插件失去解释器。

安装建议：**装到 DSH 自带 Python 最省事**（设置页默认也是往它装），它是默认顺序里的第一优先；只装到系统 Python 也能被找到，但把 `pythonPrefer` 设为 `system`、或用 `pythonPath` 指过去更稳妥。

---

## 6. 转换产物放在哪里

- 位置：**源文件旁边**（同目录），文件名是 `<原名>-<8 位哈希>.md`。
- 哈希由 **绝对路径 + 大小 + 修改时间 + 转换参数** 计算，源文件一变就会生成一个新的 `.md`；源文件没变且 `.md` 还在时直接复用（返回里会写“已有转换结果”），传 `force: true` 强制重转。
- 除了这个 `.md`，插件**不写任何东西**：没有临时目录、没有登记表、没有缓存元数据、没有后台清理任务。转换完成的那一刻，磁盘上的变化就只有多出来的这一个 `.md`。
- `.md` 归你所有：插件自己不删，也没有 `clean` action 或设置页按钮去删。不想留就自己删，原 Office 文件不受任何影响。
- 想让产物集中到某个子目录，把 `tmpDir` 配成一个相对路径（如 `tmpDir: '.md-out'`，相对工作区）或绝对路径即可；留空（默认）就是“和源文件放一起”。
- 建议把产物文件名模式加进 `.gitignore`（例如 `*-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f].md`），免得转换结果被提交进仓库。

---

## 7. 配置项

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
| `maxPreviewChars` | `4000` | `preview` 参数上限 |
| `maxRowsPerSheet` | `400` | 每个工作表/表格最多输出行数 |
| `maxTableCols` | `24` | 表格最多输出列数 |
| `maxCellsPerSheet` | `20000` | 每个工作表最多导出单元格数 |
| `registerSkill` | `true` | 是否注册那份技能说明 |
| `registerSettings` | `true` | 是否注册「Office 转换」设置页 |
| `autoAdoptEnv` | `true` | 启动时如果发现 **DSH 自带运行时**的解释器里已经有 MarkItDown，就自动登记它，以便卸载插件时一并清理。用户自己的 Python 不会被自动登记 |
| `removeEnvOnUninstall` | `true` | 在 DSH 里卸载本插件时，是否自动 `pip uninstall` 环境记录里的包。设为 `false` 则只删记录文件、不碰 Python 环境。**这个开关只在真正卸载插件时生效，禁用 / 关闭 / 重启都不受影响** |

---

## 8. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 重启后工具仍不出现 | 看 `<profile>\cordis.patch.yml` 里受管块的 `name` 是否等于 `node_modules` 下的目录名；确认 `node_modules\dsh-plugin-office-markdown\lib\index.js` 存在 |
| 设置里找不到「Office 转换」 | ① 必须**重启过** DSH —— `dsh.client` 声明只在启动扫描时加载；② 确认 `node_modules\dsh-plugin-office-markdown\lib\client.js` 存在；③ `registerSettings` 是否为 `true`；④ 该 profile 有没有 `webServer`（CLI profile 没有，页面不会出现，工具照常可用） |
| 「插件」页里看不到本插件 | 只有作为 **bundle** 登记进 profile 的包才会出现在这一页（判据：包名同时出现在 `<profile>\package.json` 的 `dsh.profile.bundles` 和 `dependencies` 里）。只往 `cordis.patch.yml` 写受管块的装法，插件能用、设置页也有，但「插件」页不会列出它。改用 **方式 A** 重装成 bundle 即可（见第 1 节） |
| 设置页能打开但所有区块都报错 | 客户端走的是 `/office-markdown/api/*`。说明宿主半边没激活，或 `webServer` 路由没注册成功；看 DSH 启动日志里 `office-markdown` 这一条的状态 |
| 改了 `lib/*.js` 没生效 | DSH 不会重新 import 已缓存的插件模块，**必须重启 DSH**。只改 `lib/client.js` 则由 HMR 热替换，刷新页面即可 |
| 提示 “spawn uvx ENOENT” / “spawn markitdown ENOENT” | 本机没有 `uv`，`markitdown` 也不在 PATH。**两者都不是必需的**：只要某个 Python 装了 markitdown，就会命中第 3 级 |
| 装了 markitdown 但插件仍走兜底 | 多半是装到了别的 Python。先传 `action:"status"`（**无需 `path`**）看 🐍 明细里哪个环境是 `✅ 使用中`；再确认那个解释器能跑 `-m markitdown --help`。要固定就用 `pythonPath` 指到它，要换顺序改 `pythonPrefer`。探测结果有 10 分钟缓存，`status` 会强制重探 |
| 结果开头有“非 MarkItDown … 保真度有限” | 说明走的是第 4/5 级兜底。按第 5 节装 `markitdown[all]` 即可提升保真度 |
| PDF 转换失败 | Node 兜底不支持 PDF；需要 MarkItDown 或带 pypdf 的 Python 兜底 |
| 设置页一键配置很慢 / 失败 | `markitdown[all]` 约 90 MB，需要联网。失败时页面的任务日志里会有 pip 的最后几行错误；也可以手动重试：`& "<python>" -m pip install "markitdown[all]"` |
| 想彻底关闭 | 受管块 `enabled: false` 后重启，或 DSH 插件管理里禁用 |
| `install.ps1` 报“禁止运行脚本” | 先执行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force` |
| `install.ps1` 中文乱码 / 语法报错 | 本文件与脚本均带 UTF-8 BOM，请勿用会去掉 BOM 的编辑器重存 |
| `install.ps1` 说“没有找到任何 Python 解释器” | 目标电脑还没装 Python。插件仍能用（走 Node 兜底）；装上 Python 后重跑 `& .\install.ps1 -SkipCopy` 就能看到它 |
| 卸载后 markitdown 还在 | 只有**登记过**的包才会被卸载：用设置页「一键配置」装/登记的（记录里 `added` 的那些），以及 DSH 自带运行时里被自动登记的那一份。你在**别的** Python 环境里自己 `pip install` 的、或者登记之后又手工装到别处的，插件都不会去动。要干净卸载就手工 `pip uninstall markitdown`；如果连环境记录都没写下来，说明当时登记失败了，页面上会有一行「登记失败」的日志 |
| 卸载插件后 Python 包没被清掉 | 先看 `~/.dsh/dsh-plugin-office-markdown-removal.log`。① 如果 profile 的 `package.json` 里 `dsh.profile.bundles` 仍列着本插件，插件会认为你只是禁用了它，不会动手；② 如果 120 秒内包目录一直没消失（例如卸载被 pnpm 的其它错误打断），看门狗会超时放弃 —— 此时改用 `install.ps1 -Uninstall` 照样能清；③ 检查 `removeEnvOnUninstall` 是不是被改成了 `false` |
| 转换出来的 `.md` 会自己消失吗 | **不会，这是设计如此。** 插件只在源文件旁边写这一个 `.md`，不产生任何临时文件，也不删自己的产物。不想留就自己删 |

---

## 9. 包内文件与兼容性

```
dsh-plugin-office-markdown/
├── package.json          # dsh.bundle.patch → cordis.patch.yml；dsh.client → lib/client.js
├── cordis.patch.yml      # 供 bundle 方式安装时使用的 insert 条目
├── install.ps1           # 安装 / 卸载 脚本（含备份与受管块）
├── README.md             # 本文件
└── lib/
    ├── index.js          # 工具 + 技能 + read 守卫的注册（host half）
    ├── convert.js        # 类型判定、转换器探测、转换链（纯 Node 标准库）
    ├── env.js            # Python 环境探测 / 一键配置 / 登记已有环境 / 按记录卸载（host half）
    ├── paths.js          # DSH 数据目录解析（~/.dsh、profiles、runtimes），带环境变量回退
    ├── removal-watchdog.js # 卸载看门狗：脱离宿主轮询确认「已被移除」，确认后清 Python 环境
    ├── settings-api.js   # /office-markdown/api/* 路由 + 后台任务状态（host half）
    ├── client.js         # 「Office 转换」设置页（client half，手写、无构建步骤）
    ├── fallback-node.js  # 第 5 级：纯 Node OOXML 兜底（无 Python / 无网络）
    └── fallback.py       # 第 4 级：Python 兜底（docx/xlsx/pptx/pdf/csv/rtf/json…）
```

- Node：仅使用内置模块（`fs`/`path`/`os`/`zlib`/`crypto`/`child_process`），**没有任何 npm 依赖**，不需要 `npm install`。
- Python 兜底：只用标准库 + 可选 `python-docx` / `openpyxl` / `python-pptx` / `pypdf`。
- 除 `@deepseek-ai/dsh-tools`（由 DSH 自身提供，用于 `defineTool`）外不 import 任何宿主包。
- `apply()` 的全部注册都包在 `ctx.effect(...)` 里，禁用或卸载时会被干净地回收；`webServer` 是可选服务，通过 `ctx.inject(['webServer'], ...)` 注册路由 —— CLI profile 缺这个服务时，只有设置页不出现，工具与技能照常工作。
- `client.js` 是手写的 `window.__ModuleLoader__.load({...})` 模块，只用 `require("react")`，不依赖任何 DSH 内部 UI 包，也不依赖任何 CSS 类（样式全内联，明暗主题都能用）。
- 卸载时的环境清理走 `ctx.effect(() => () => scheduleRemovalCleanup(...))`：先按第 3 节的判定顺序区分「被卸载」和「被禁用 / 关闭 / 重启」，只有确认是被卸载时才通过 `lib/removal-watchdog.js` 派发一个**脱离宿主的 Python 进程**（`detached` + `unref`，不拖住宿主退出），由它轮询 `removalConfirmed()`（包目录已消失 **且** profile 配置不再提到 `office-markdown`），确认后再执行 `uninstallMarkitdown()`。看门狗带单实例锁（`lib/paths.js` 的 `watchdogLockPath()`）与 120 秒寿命上限。
- `lib/paths.js` 集中解析 DSH 数据目录，三级回退：`ctx.get('profileContext').dir` 反推（`<home>/profiles/<name>` → `<home>`）→ 环境变量 `DSH_HOME` → `~/.dsh`。所以把 DSH 的数据目录换到别处（或用非默认 profile）也不会找错快照与日志。插件从不引用 DSH 的**安装**目录，换机器、换安装路径都不受影响。
- 插件运行时在用户目录下最多留**一个**小文件：环境记录 `dsh-plugin-office-markdown.env.json`，只在用设置页配置/登记过环境、或 DSH 自带运行时里已有的 MarkItDown 被自动登记时才存在；一键卸载、卸载插件、`-Uninstall` 时都会删除。除此之外没有任何状态文件 —— 转换产物只有源文件旁边那一个 `.md`。
- 安装脚本另外会在 `<profile>` 下留 `cordis.patch.yml.bak`（固定文件名，每次覆盖）。它不属于插件运行时，`-Uninstall` 不删它，确认没问题后可自行删除。