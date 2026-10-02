<h1 align="center">dsh-plugin-office-markdown</h1>

<p align="center"><a href="./README.md">中文</a> | <a href="./README.en.md">English</a></p>

<p align="center"><strong>读取 Office / PDF 之前，先把它转成 Markdown</strong><br><em>用一行路径代替整份全文。</em></p>

<p align="center"><sub>docx · xlsx · pptx · pdf · csv ｜ 0 个 npm 依赖 ｜ 转换全在本地 ｜ 产物写在源文件旁边 ｜ 卸载自动清理 Python 环境</sub></p>

<p align="center">
  <a href="https://github.com/Z8906/dsh-plugin-office-markdown/releases"><img src="https://img.shields.io/github/v/release/Z8906/dsh-plugin-office-markdown?style=flat-square&color=5786FE&label=release" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen?style=flat-square" alt="Node"></a>
  <img src="https://img.shields.io/badge/npm%20deps-0-brightgreen?style=flat-square" alt="0 npm deps">
  <img src="https://img.shields.io/badge/DSH-bundle%20plugin-5786FE?style=flat-square" alt="DSH bundle plugin">
  <a href="https://github.com/Z8906/dsh-plugin-office-markdown/stargazers"><img src="https://img.shields.io/github/stars/Z8906/dsh-plugin-office-markdown?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <a href="https://www.deepseek.com" title="deepseek-harness (dsh)"><img src="https://cdn.simpleicons.org/deepseek/5786FE" height="26" alt="deepseek-harness"></a>
</p>

<p align="center">
  <a href="docs/installation.md">安装</a> ·
  <a href="docs/usage.md">使用</a> ·
  <a href="docs/converters.md">转换器</a> ·
  <a href="docs/configuration.md">配置</a> ·
  <a href="docs/uninstall.md">卸载</a> ·
  <a href="docs/troubleshooting.md">故障排查</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

---

模型读 `.docx` / `.xlsx` / `.pptx` / `.pdf` 时，原文件是被**整份**塞进上下文的：一个 36 KB 的 `.docx` 约等于三万 token，而它真正的内容可能只有几百字。这个插件把「读取」拆成两步 —— **先在本地转成 Markdown，再按需读那个 `.md`**。

```
报表.xlsx（36 KB）  ──▶  本地转换  ──▶  报表-a1b2c3d4.md（0.5 KB）  ──▶  按需 read
                        MarkItDown 或内置兜底        原文件一动不动
```

同样的内容，从约三万 token 降到约一百多 token。

## 为什么用它

- **省 token 是刚需**：一行路径（约 40 token）代替整份全文。
- **转换全在本地**：不联网（除首次 `uvx` 下载）、不改原文件、不消耗 API 额度。
- **没有 Python 也能用**：内置 Node 兜底只用 `zlib` 解 OOXML —— 零依赖、零安装、离线可用。
- **产物归你所有**：`.md` 写在**源文件旁边**，插件默认**从不删除**它。
- **不硬读**：可选的 `read` 守卫会拦下对二进制 Office 文件的直接读取，并把已经转好的 `.md` 路径直接给它。
- **卸载干净**：在 DSH 里移除插件时，它把自己装的 MarkItDown 及依赖一并 `pip uninstall`；**DSH 自带的包和你自己的包一个都不动**。
- **零残留**：除了那个 `.md`，不写临时目录、不写缓存元数据、不在包目录里留 `__pycache__`。

## 和直接读原文件比

| | 直接 `read` 原文件 | 装了这个插件 |
| --- | --- | --- |
| 上下文占用 | 整份文件（36 KB ≈ 3 万 token） | 一行路径 ≈ 40 token |
| 读取策略 | 全文注入 | 先读前 200 行看结构，再 `grep` 定位 |
| 原文件 | 被当作文本硬读（二进制内容不可用） | 守卫拦下，改读转好的 `.md` |
| 产物 | 无 | 源文件旁边一份 `.md`，归你所有 |
| 依赖 | 无 | **0 个 npm 依赖**；Python 可选 |

## 安装

在 DSH 的 **设置 → 插件 → 安装** 里填一行，回车：

```
github:Z8906/dsh-plugin-office-markdown
```

它会作为 bundle 装进 profile —— **设置 → 插件** 里能看到它、也能一键卸载。装完**重启 DSH**。

- 想锁定版本：改成 `github:Z8906/dsh-plugin-office-markdown#v1.2.1`
- 目标机器没有 git：用 [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) 里的 `.tgz`（在安装框里填绝对路径），或用 `.zip` 源码快照 + `install.ps1`

四种安装方式、手工装法与升级步骤见 **[安装文档](docs/installation.md)**。

> **升级请注意**：本插件**不要**走 DSH 界面上的「卸载 → 重新安装」—— 卸载会触发它自己的环境清理（那是设计行为，见 [卸载文档](docs/uninstall.md)）。升级请用 `pnpm update`，或直接在安装框里 add 同一个 git 地址。DSH 官方提示的「升级需先卸载再安装」对普通插件成立，对这个插件是例外。

## 用起来是什么样

装好之后不需要记任何命令，直接说「读取并总结这个 xlsx」即可 —— 插件注册的技能会要求模型先转换：

```
read_office_as_markdown({ path: "报表.xlsx" })
→ 报表-a1b2c3d4.md（0.5 KB，37 行，≈115 tokens）
  转换器：本机 MarkItDown（高保真）
  结构索引：Sheet1 · Sheet2 · 合计
  读取建议：先读前 200 行看结构，再用 grep 在同一个 .md 里定位
```

进上下文的只有路径、体积、行数与结构索引 —— **全文不会被塞进来，产物本身也永远不会被裁剪**。

工具的全部参数、设置页、HTTP 路由见 **[使用文档](docs/usage.md)**。

## 转换器与保真度

按顺序探测，第一个可用的胜出：

| 顺序 | 转换器 | 保真度 | 依赖 |
| --- | --- | --- | --- |
| 1 | `uvx markitdown`（临时运行） | 高 | `uv` + 网络（首次） |
| 2 | 本机 `markitdown` 命令 | 高 | 已安装 markitdown |
| 3 | `python -m markitdown` | 高 | Python + markitdown |
| 4 | 内置 **Python** 兜底 | 有限 | 任意 Python 3（可选库增强） |
| 5 | 内置 **Node** 兜底 | 有限 | **无** |

第 5 级随插件打包，**没有 Python、没有网络也能用**（`.docx` / `.xlsx` / `.pptx` 本质就是 zip + xml）。PDF 和旧版二进制格式需要 MarkItDown 或第 4 级。

每一份产物第一行都记着它是谁转的（Markdown 渲染时不可见）：

```
<!-- dsh-office-markdown converter=python-module fidelity=high at=2026-10-03T01:00:00.000Z srcbytes=5462 srchash=c7753efa1a3f81d8 -->
```

命中缓存时插件从这一行读回**真实的**转换器与保真度，不会无条件声称「高保真」；由 1.1.x 生成的旧产物会被如实报告为「保真度未知」。

想升级到最高保真度：打开 **设置 → Office 转换**，点「一键配置 MarkItDown 环境」（安装脚本**不会**替你装任何 Python 包）。多 Python 环境怎么选、兜底支持哪些格式、怎么手工装，见 **[转换器文档](docs/converters.md)**。

## 文档

| 文档 | 什么时候看 |
| --- | --- |
| [安装](docs/installation.md) | 四种安装方式、手工安装、升级、验证 |
| [使用](docs/usage.md) | 工具参数、技能说明、`read` 守卫、设置页、HTTP 路由 |
| [转换器](docs/converters.md) | 转换器链、保真度、多 Python 环境、安装 MarkItDown |
| [配置](docs/configuration.md) | 全部配置项与默认值 |
| [产物与文件](docs/artifacts.md) | `.md` 放在哪、插件会留下哪些文件、卸载日志 |
| [卸载](docs/uninstall.md) | 启用 / 禁用 / 卸载，以及卸载时 Python 环境如何被清理 |
| [故障排查](docs/troubleshooting.md) | 常见现象与 FAQ |
| [开发](docs/development.md) | 包内文件、实现细节、发布流程 |
| [更新日志](CHANGELOG.md) | 每个版本改了什么 |

## 依赖与兼容性

- **Node ≥ 18**，只用内置模块（`fs` / `path` / `os` / `zlib` / `crypto` / `child_process` / `string_decoder`）—— **0 个 npm 依赖**，不需要 `npm install`。
- **Python 与 MarkItDown 全部可选**：两者都没有时，插件走第 5 级 Node 兜底照常工作。
- 除宿主提供的 `@deepseek-ai/dsh-tools`（用于 `defineTool`）外，不 import 任何宿主包。
- 只支持 **DeepSeek Harness**；`@deepseek-ai/dsh-base` 之外的 profile 组合不影响使用。
- CLI profile 没有 `webServer` 服务时，设置页不会出现，但工具与技能完全不受影响。

## 卸载

在 DSH 的 **设置 → 插件** 里点卸载即可。插件会先确认自己**真的被移除**（而不是被禁用 / 关闭 / 重启），再派一个脱离宿主的看门狗进程，把自己登记过的 Python 包清掉。

**禁用、关闭、重启 DSH 都不会触发清理，也不会留下任何常驻进程。** 只有真正卸载才会。

清理范围严格限定在它自己的环境记录里：DSH 运行时自带的包、被其它组件依赖的包、以及你自己装的包，一个都不动。细节见 **[卸载文档](docs/uninstall.md)**。

## 贡献

本项目**主要由 DeepSeek 开发**。Issue 与 PR 都欢迎 —— 尤其是转换失败的文件样本（脱敏后）。

- 改 `lib/*.js` 之后必须**重启 DSH** 才生效（Node ESM 缓存）；改 `lib/client.js`（设置页界面）会被 HMR 热替换。
- 改了 `lib/` 又用 `file:` tarball 分发时，记得先升 `package.json` 的 `version`（pnpm 按「路径 + 版本号」缓存）。
- 发布流程、CI 做了什么，见 **[开发文档](docs/development.md)**。

## Star History

<a href="https://star-history.com/#Z8906/dsh-plugin-office-markdown&Date">
  <img src="https://api.star-history.com/svg?repos=Z8906/dsh-plugin-office-markdown&type=Date" alt="Star History Chart" width="600">
</a>

## 许可证

[MIT](LICENSE) © 2026 dsh-plugin-office-markdown contributors