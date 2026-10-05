<h1 align="center">dsh-plugin-office-markdown</h1>

<p align="center">
  在 DeepSeek Harness 读取 Office / PDF 之前，先把它们转成 Markdown ——<br>
  进入模型上下文的是一个文件路径，而不是整份文件的原始内容。
</p>

<p align="center">
  <a href="README.md">中文</a> ｜ <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/Z8906/dsh-plugin-office-markdown/releases"><img alt="release" src="https://img.shields.io/github/v/release/Z8906/dsh-plugin-office-markdown?style=flat-square&label=release"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square">
  <img alt="npm" src="https://img.shields.io/npm/v/dsh-plugin-office-markdown?style=flat-square&label=npm">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen?style=flat-square">
  <img alt="npm dependencies" src="https://img.shields.io/badge/npm%20deps-0-brightgreen?style=flat-square">
</p>

<p align="center">
  <a href="#安装">安装</a> ｜
  <a href="#怎么用">使用</a> ｜
  <a href="#转换器">转换器</a> ｜
  <a href="#文档">文档</a> ｜
  <a href="CHANGELOG.md">更新日志</a>
</p>

---

> 🤖 **本项目的代码与文档主要由 AI 生成** —— 由 DeepSeek Harness 里的编码 agent 撰写，经维护者审阅后发布。
> 配置项、HTTP 路由、转换器链与文件清单等内容都**逐项对照过源码**；但文档仍可能落后于实现，
> 或存在表述不准、细节缺失，**请以代码为准**。详见[文末说明](#关于本文档)。

转换在**本机**完成，不联网（可选的 MarkItDown 首次下载除外）、不修改原文件、
不消耗 API 额度，插件本身**没有任何 npm 依赖**。

## 安装

在 DSH 的 **设置 → 插件 → 安装** 里填一行，回车，然后**重启 DSH**。

**① 从 npm 安装（推荐）** —— npm 上从 1.2.2 起有正式发布：

```
dsh-plugin-office-markdown
```

要锁版本就在后面加 `@版本`：`dsh-plugin-office-markdown@<版本>`，`<版本>` 形如 `1.2.2`。

**② 从 GitHub 安装** —— npm 不可达时用这条：

```
github:Z8906/dsh-plugin-office-markdown
```

要锁 tag 就在末尾加 `#<tag>`：`github:Z8906/dsh-plugin-office-markdown#<tag>`，
`<tag>` 形如 `v1.2.2`（见 [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases)）。

**③ 离线 / 没有 git** —— 用 Releases 里的 `.tgz`，在安装框里填它的**绝对路径**；
也可以填本地克隆目录的路径（`file:` 前缀或绝对路径）。

习惯命令行的话，`dsh plugin` 会把参数转发给 profile 目录里的 pnpm：

```sh
dsh plugin --profile <你的 profile> add dsh-plugin-office-markdown
```

全部安装方式、手工装法与升级步骤见 **[安装文档](docs/installation.md)**。

> **升级不要走「卸载 → 重新安装」。** 本插件在真正被卸载时会清理它自己登记过的 Python 包
> （见 [卸载文档](docs/uninstall.md)），那条路的结果是「插件更新了、Python 环境却没了」。
> 正确做法：`pnpm update dsh-plugin-office-markdown`，或在插件市场里点更新，
> 或直接在安装框里再 add 一次同一个地址。

## 怎么用

装好之后不需要记命令，直接说「读取并总结这个 xlsx」即可 —— 插件注册的技能会让模型先调用转换工具：

```
read_office_as_markdown({ path: "报表.xlsx" })
```

返回值里有转换后 `.md` 的路径、体积、行数，以及一份结构索引（章节 / 工作表 / 幻灯片的标题与大致行号），
并给出读取建议：先读前 200 行看结构，再用 grep 在同一个 `.md` 里定位。
**产物本身不会被裁剪** —— 交给模型的是一个完整的 Markdown 文件。

工具的其他用法：批量（`paths`，或把目录交给 `path`）、只要结构索引（`action: "outline"`，
不触发转换）、清理同一源文件的旧产物（`action: "clean"`，默认先干跑）、查看当前转换器
（`action: "status"`）。全部参数见 **[使用文档](docs/usage.md)**。

## 转换器

按顺序探测，第一个可用的胜出。下表对照 `lib/convert.js`：

| 顺序 | 转换器 | 保真度 | 需要 |
| --- | --- | --- | --- |
| 1 | `uvx markitdown`（临时运行） | 高 | `uv` + 网络（首次） |
| 2 | 本机 `markitdown` 命令 | 高 | 已安装 markitdown |
| 3 | `python -m markitdown` | 高 | Python + markitdown |
| 4 | 插件内置 Python 兜底（`lib/fallback.py`） | 有限 | 任意 Python 3，可选库能提升效果 |
| 5 | 插件内置 Node 兜底（`lib/fallback-node.js`） | 有限 | 无 |

**第 5 级不需要 Python、也不需要网络**：它用 Node 内置的 `zlib` 直接解析 OOXML
（`.docx` / `.xlsx` / `.pptx` 本身就是 zip + xml）。支持 `.docx` `.docm` `.xlsx` `.xlsm` `.pptx` `.pptm`；
`.pdf` 与旧版二进制格式（`.doc` `.xls` `.ppt`）需要 MarkItDown 或第 4 级。

每份产物的第一行记录它是谁转的；命中缓存时插件从这一行读回**真实的**转换器与保真度，
而不是无条件声称「高保真」：

```
<!-- dsh-office-markdown converter=python-module fidelity=high at=<时间> srcbytes=<字节数> srchash=<哈希> -->
```

想要高保真：打开 **设置 → Office 转换**，点「一键配置 MarkItDown 环境」。
**安装脚本不会替你装任何 Python 包**，装到哪个解释器由你在页面上选。
细节见 **[转换器文档](docs/converters.md)**。

## 设置页

**设置 → Office 转换** 提供：当前转换器、本机 Python 环境探测、一键配置 / 卸载 MarkItDown、
插件登记的环境记录、以及「试转一个文件」（不进模型、不走缓存，直接在本机跑一遍转换链看结果）。

页面上的按钮走插件自己的 HTTP 路由 `/office-markdown/api/*`，路由清单见 [使用文档](docs/usage.md)。

## 卸载

在 **设置 → 插件** 里点卸载即可。插件会先确认自己**真的被移除**（而不是被禁用 / 关闭 / 重启），
再派一个脱离宿主的看门狗进程，把它登记过的 Python 包 `pip uninstall` 掉。

**禁用、关闭、重启都不会触发清理，也不会留下任何常驻进程。**
清理范围严格限定在插件自己的环境记录里：DSH 运行时自带的包、被其它组件依赖的包、
以及你自己装的包，一个都不动。细节见 **[卸载文档](docs/uninstall.md)**。

## 依赖与兼容

- **Node ≥ 18**，只用内置模块（`fs` / `path` / `os` / `zlib` / `crypto` / `child_process` / `string_decoder`），
  **0 个 npm 依赖**，不需要 `npm install`。
- **Python 与 MarkItDown 全部可选**：两者都没有时走第 5 级 Node 兜底。
- 除宿主提供的 `@deepseek-ai/dsh-tools`（用于 `defineTool`）外，不 import 任何宿主包。
- 只支持 DeepSeek Harness。profile 没有 `webServer` 服务时（例如 CLI profile），
  设置页不会出现，工具与技能不受影响。

## 文档

| 文档 | 内容 |
| --- | --- |
| [安装](docs/installation.md) | 四种安装方式、手工安装、升级、验证 |
| [使用](docs/usage.md) | 工具参数、技能、`read` 守卫、设置页、HTTP 路由 |
| [转换器](docs/converters.md) | 转换器链、保真度、多个 Python 环境 |
| [配置](docs/configuration.md) | 配置项与默认值（对照 `lib/index.js` 的 `DEFAULTS`） |
| [产物与文件](docs/artifacts.md) | `.md` 放在哪、插件会留下哪些文件 |
| [卸载](docs/uninstall.md) | 启用 / 禁用 / 卸载与清理范围 |
| [故障排查](docs/troubleshooting.md) | 常见现象与处理 |
| [开发](docs/development.md) | 包内文件、本地开发、发布 |
| [更新日志](CHANGELOG.md) | 每个版本改了什么 |

## 关于本文档

本仓库的 README、`docs/`、`CHANGELOG.md` 以及各版本的 Release 说明，**主要由 AI 生成**
（DeepSeek Harness 里的编码 agent 撰写），由维护者审阅后发布。

其中配置项、HTTP 路由、转换器链、文件清单等内容都**逐项对照过源码**；但文档仍可能落后于实现，
或存在表述不准、细节缺失之处，**请以代码为准**。发现问题欢迎提 issue。

文档中**不写没有实测依据的数字**（例如「能省多少 token」「占用多少内存」）——
这类断言缺少可复现的测量过程，因此不列出。

## 许可证

[MIT](LICENSE) © 2026 dsh-plugin-office-markdown contributors