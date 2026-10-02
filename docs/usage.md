# 使用

[← 回到 README](../README.md)

## 工具：`read_office_as_markdown`

这是插件注册的唯一工具。它把工作区里的 Office / PDF 文件转成 Markdown，
**只返回 `.md` 的路径、体积、行数和结构索引**，不把全文塞进上下文。

### 参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `action` | 字符串 | `auto`（默认）/ `outline` / `read` / `status` / `clean` |
| `path` | 字符串 | 单个文件或目录 |
| `paths` | 字符串数组 | 一次处理多个文件或目录，省掉逐文件来回 |
| `preview` | 数字 | 返回转换结果开头的字符数，默认 0（只给路径，最省 token） |
| `recursive` | 布尔 | `path` 是目录时是否递归子目录，默认 `false`；一次最多展开 200 个文件 |
| `force` | 布尔 | 忽略已有转换结果，重新转换 |
| `dryRun` | 布尔 | 仅对 `action: "clean"` 有效。`true`（默认）只报告要删什么，传 `false` 才真删 |

### `action` 的各个取值

- **`auto`（默认）** —— 根据文件类型自动决定：需要转换就转换，已经转过就直接给出索引。
  日常用这个就够。
- **`outline`** —— 只返回结构索引，**绝不触发转换**。想先看看有哪些章节 / 工作表 / 幻灯片时用。
- **`read`** —— 读取已转换的结果。
- **`status`** —— 查看当前可用的转换器与 Python 环境。
- **`clean`** —— 清理同一源文件的陈旧产物（源文件反复改动时会留下多份）。

工具返回的结构索引包含章节、工作表、幻灯片标题和大致行号，并给出读取建议：
先读前 200 行看结构，再用 grep 在同一个 `.md` 里定位需要的片段。
**产物本身不会被裁剪** —— 交给模型的是一个完整的 Markdown 文件。

## 技能

插件注册一个技能，它会让模型在遇到 Office / PDF 文件时**先转换再读取**。
装好之后不需要记任何命令，直接说「读取并总结这个 xlsx」即可。

## `read` 守卫

配置项 `guardReadTool`（默认开）会在模型试图直接用 `read` 打开受支持的二进制
Office / PDF 文件时介入，提示改用本插件。这样能避免整份文件被读进上下文。

## 设置页

**设置 → Office 转换** 提供五块内容：

1. **当前转换器** —— 现在实际用的是哪一级。
2. **本机 Python 环境探测** —— 列出候选解释器以及各自是否装了 markitdown。
3. **一键配置 / 卸载 MarkItDown** —— 装到哪个解释器由你在页面上选。
4. **插件登记的环境记录** —— 记录了哪些包是插件装的（卸载时只清理这些）。
5. **试转一个文件** —— 不进模型、不走缓存，直接在本机跑一遍完整转换链看结果。

配置项的含义见 [配置文档](configuration.md)。

## HTTP 路由

设置页上的按钮走插件自己的路由，前缀 `/office-markdown`：

| 方法 | 路由 | 作用 |
| --- | --- | --- |
| GET | `/office-markdown/api/status` | 快 —— 当前转换器、环境记录快照、运行中的任务 |
| GET | `/office-markdown/api/probe` | 慢 —— 逐个检查解释器与包 |
| GET | `/office-markdown/api/job` | 正在跑的安装 / 卸载任务的进度 |
| POST | `/office-markdown/api/convert-test` | 入参 `{ path }`，在本机跑一遍真实的转换链 |
| POST | `/office-markdown/api/env/install` | 入参 `{ target? }`，`pip install "markitdown[all]"` |
| POST | `/office-markdown/api/env/uninstall` | 精确卸载插件自己装过的那些包 |

页面靠轮询 `/api/job` 拿进度，所以一次几分钟的 pip 运行不会超时。

---

> 本文档主要由 AI 生成，参数与路由对照过 `lib/index.js` 与 `lib/settings-api.js`，
> 但仍可能与实现有出入。说明与免责见 [README 的「关于本文档」](../README.md#关于本文档)。