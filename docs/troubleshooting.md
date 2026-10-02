# 故障排查

[← 返回首页](../README.md) ｜ [安装](installation.md) · [转换器](converters.md) · [配置](configuration.md) · [卸载](uninstall.md)

---

## 安装与加载

| 现象 | 原因与处理 |
| --- | --- |
| 重启后工具仍不出现 | 看 `<profile>\cordis.patch.yml` 里受管块的 `name` 是否等于 `node_modules` 下的目录名；确认 `node_modules\dsh-plugin-office-markdown\lib\index.js` 存在 |
| 设置里找不到「Office 转换」 | ① 必须**重启过** DSH；② 确认 `lib\client.js` 存在；③ `registerSettings` 是否为 `true`；④ 该 profile 有没有 `webServer`（CLI profile 没有，页面不会出现，工具照常可用） |
| 设置页能打开但所有区块都报错 | 客户端走 `/office-markdown/api/*`。说明宿主半边没激活，或 `webServer` 路由没注册成功；看 DSH 启动日志里 `office-markdown` 这一条的状态 |
| 「插件」页里看不到本插件 | 只有作为 **bundle** 登记进 profile 的包才会出现在这一页（包名同时出现在 `<profile>\package.json` 的 `dsh.profile.bundles` 和 `dependencies` 里）。只往 `cordis.patch.yml` 写受管块的装法，插件能用、设置页也有，但「插件」页不列出它。改用方式 1 或 `-RegisterBundle` 重装即可 |
| 改了 `lib/*.js` 没生效 | DSH 不会重新 import 已缓存的插件模块，**必须重启 DSH**。只改 `lib/client.js` 由 HMR 热替换，刷新页面即可 |
| `install.ps1` 报「禁止运行脚本」 | 先执行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force` |
| `install.ps1` 中文乱码 / 语法报错 | 脚本以 **UTF-8 带 BOM** 保存（`README.md` 等其它文件是无 BOM）—— Windows PowerShell 5.1 只有见到 BOM 才会按 UTF-8 解码，否则按 ANSI 读，中文提示会全部乱码。**请勿用会去掉 BOM 的编辑器另存它** |
| `install.ps1` 说「没有找到任何 Python 解释器」 | 目标电脑还没装 Python。插件仍能用（走 Node 兜底）；装上 Python 后重跑 `& .\install.ps1 -SkipCopy` 就能看到它 |
| 从 Releases 下的 `.tgz` 里找不到 `install.ps1` | 这是正常的：`.tgz` 是 npm 包结构，只含 `lib/`、`cordis.patch.yml`、`README.md`、`package.json`、`LICENSE`。**要脚本请改用方式 3**：同一页的 `.zip` 源码快照里有 `install.ps1`（不必装 git），也可以 `git clone` |

---

## 转换与保真度

| 现象 | 原因与处理 |
| --- | --- |
| 提示 `spawn uvx ENOENT` / `spawn markitdown ENOENT` | 本机没有 `uv`，`markitdown` 也不在 PATH。**两者都不是必需的**：只要某个 Python 装了 markitdown，就会命中第 3 级 |
| 装了 markitdown 但插件仍走兜底 | 多半是装到了别的 Python。先传 `action: "status"`（**无需 `path`**）看 🐍 明细里哪个环境是 `✅ 使用中`；再确认那个解释器能跑 `-m markitdown --help`。要固定就用 `pythonPath`，要换顺序改 `pythonPrefer`。探测结果有 10 分钟缓存，`status` 会强制重探 |
| 结果开头有「非 MarkItDown … 保真度有限」 | 说明走的是第 4/5 级兜底。按 [转换器文档](converters.md) 装 `markitdown[all]` 即可提升保真度 |
| PDF 转换失败 | Node 兜底不支持 PDF；需要 MarkItDown 或带 `pypdf` 的 Python 兜底 |
| 返回值里保真度显示「未知」 | 那份 `.md` 是 1.1.x 生成的，第一行没有转换器标记。传 `force: true` 重转一次就会补上 |
| 设置页一键配置很慢 / 失败 | `markitdown[all]` 约 90 MB，需要联网。失败时页面任务日志里有 pip 的最后几行错误；也可手动重试：`& "<python>" -m pip install "markitdown[all]"` |

---

## 产物

| 现象 | 原因与处理 |
| --- | --- |
| 转换出来的 `.md` 越来越多 | 用 `read_office_as_markdown({ path: "报表.xlsx", action: "clean" })` 先看会删哪些（默认 `dryRun`），确认后传 `dryRun: false`；或把 `pruneStaleArtifacts` 设为 `true`。源文件内容没变、只是修改时间变了时，插件会比对内容哈希后复用旧产物，不再写重复文件 |
| 转换出来的 `.md` 会自己消失吗 | **不会，这是设计如此。** 只有你显式用 `action: "clean"`（且传了 `dryRun: false`）或把 `pruneStaleArtifacts` 设为 `true`，才会删除 |
| 想把产物集中到一个目录 | 配 `tmpDir`（见 [配置](configuration.md)）。已生成的旧产物不会自动迁移，需要手工清理 |

---

## 卸载

| 现象 | 原因与处理 |
| --- | --- |
| 卸载后 markitdown 还在 | 只有**登记过**的包才会被卸载：用设置页「一键配置」装 / 登记的，以及 DSH 自带运行时里被自动登记的那一份。你在**别的** Python 环境里自己 `pip install` 的、或登记后又手工装到别处的，插件都不会去动。要干净卸载就手工 `pip uninstall markitdown`；如果连环境记录都没写下来，说明当时登记失败了，设置页会有一行「登记失败」的日志 |
| 卸载插件后 Python 包没被清掉 | 先看 `~/.dsh/dsh-plugin-office-markdown-removal.log`。① profile 的 `package.json` 里 `dsh.profile.bundles` 仍列着本插件 → 插件认为你只是禁用了它；② 120 秒内包目录一直没消失 → 看门狗超时放弃，改用 `install.ps1 -Uninstall` 照样能清；③ 检查 `removeEnvOnUninstall` 是否被改成了 `false` |
| 升级之后 Python 环境没了 | 说明走了「卸载 → 重装」。见 [卸载文档](uninstall.md) 的警告；重启后在设置页点「一键配置 MarkItDown 环境」装回来 |

---

## FAQ

**为什么 v1.0.0 无法正常使用？**
该版本确认无法正常使用，已被 v1.1.0 及之后的版本取代。它还有两个结构性缺陷：① DSH 数据目录被写死为 `~/.dsh`，profile 或数据目录不在默认位置时会找错环境记录与日志；② 没有独立的卸载看门狗，卸载过程中重启一次 DSH，登记的 Python 包就永远清不掉。**请直接安装 v1.2.1。**

**为什么 v1.0.0 / v1.1.0 / v1.1.1 的日期都是 2026-10-01？**
因为这三个 tag 与 Release 是在那天一次性补建的（tag 时间同为 `20:58:23`，Release 发布时间相隔 2 秒）。项目实际开发自 2026-08 起；补档不等于发布。

**这个插件会自己升级吗？**
不会。DSH 没有升级按钮，也不会自动升级；换版本请按 [安装文档](installation.md) 的升级步骤做，然后重启。

**需要联网吗？**
不需要。只有三种情况会用到网络：首次 `uvx` 下载 MarkItDown、设置页一键配置 `pip install`、以及你自己去 clone 仓库。

**会把我的 `.md` 删掉吗？**
不会。插件默认只创建文件、从不主动删除；`action: "clean"` 默认也是 `dryRun`（只报告）。它连自己写过的 `.md` 都不删，更不会碰同目录里其它文件。

**会不会动我自己装的 MarkItDown？**
不会。只有写进环境记录的包（本插件装的、或经你确认登记的）才会被卸载；没登记过的一个都不动。

**上架到 DSH 的「插件市场」了吗？**
`github:Z8906/dsh-plugin-office-markdown` 已经是完整的 bundle 安装，功能和从市场里装的一模一样，**一键安装不需要上架**。想让它在市场里能被搜到，需要往市场的目录清单（[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com/plugins.json)）提一个条目 —— 那是人工维护的清单；发布到 npm 是另一条独立的路。此外，用 `github:` 形式装进去的插件，DSH 市场**能检测到更新**（拿 lockfile 里的 commit 与仓库远程 HEAD 比对），但不会自动升级。

**为什么升级不能「卸载再重装」？**
因为本插件把「卸载」定义成了一次真正的清理动作（`pip uninstall` 它登记过的包）。DSH 的安装流程与官方提示都假设「卸载是安全的、无副作用的」，对这个插件不成立。见 [卸载文档](uninstall.md)。