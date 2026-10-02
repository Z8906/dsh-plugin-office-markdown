# 使用

[← 返回首页](../README.md) ｜ [安装](installation.md) · [转换器](converters.md) · [产物与文件](artifacts.md)

---

## 工具 `read_office_as_markdown`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `path` | 否 | 文件**或目录**路径（相对工作区或绝对路径）。传目录时按扩展名找出其中的 Office / PDF 文件。`action: "status"` 时可省略 |
| `paths` | 否 | 批量处理：多个文件或目录路径（等价于把数组交给 `path`） |
| `action` | 否 | `auto`（默认）/ `convert`（强制转换）/ `read`（读取已转换结果开头）/ `outline`（只给结构索引，**绝不触发转换**）/ `clean`（清理同一源文件的陈旧产物）/ `status`（查看可用转换器与各 Python 环境） |
| `force` | 否 | `true` 时忽略已有结果重新转换 |
| `preview` | 否 | 返回 Markdown 开头的字符数（默认 0，只返回路径最省 token；上限为 `maxPreviewChars`） |
| `recursive` | 否 | `path` 是目录时是否递归子目录（默认 `false`）；无论是否递归，一次最多展开 200 个文件 |
| `dryRun` | 否 | 仅对 `action: "clean"` 有效：`true`（默认）只报告，传 `false` 才真的删除 |

### 返回值

包含路径、体积、**行数**、token 估算、转换器与保真度，外加一份**结构索引**（章节 / 工作表 / 幻灯片的标题与大致行号）。

**不会把全文塞进上下文，也绝不会裁剪产物。** 同时给出读取策略：先用 `read` 读前 200 行看结构，再用 `grep` 在同一个 `.md` 里定位片段，不要整份读入。

### 产物第一行的标记

产物第一行会写入一行 HTML 注释，记录它是谁转的（Markdown 渲染时不可见）：

```
<!-- dsh-office-markdown converter=python-module fidelity=high at=2026-10-03T01:00:00.000Z srcbytes=5462 srchash=c7753efa1a3f81d8 -->
```

| 字段 | 含义 |
| --- | --- |
| `converter` | `uvx` / `markitdown-cli` / `python-module` / `builtin`（Python 兜底）/ `node-builtin`（Node 兜底） |
| `fidelity` | `high`（MarkItDown）或 `limited`（内置兜底） |
| `at` | 转换时刻 |
| `srcbytes` / `srchash` | 源文件的字节数与内容哈希，用于判断「修改时间变了但内容没变」 |

命中缓存时插件就从这一行读回真实的转换器与保真度，而不是无条件声称「保真度高」。由 1.1.x 生成的旧产物没有这一行，会被如实报告为「保真度未知」，传 `force: true` 重转一次即可。

另外，如果缓存里的产物是**内置兜底**转出来的、而这台机器现在已经有 MarkItDown，插件不会默默复用那份低保真结果，而是重新转换一次并说明原因。

### 批量与目录展开

批量处理（`paths` 或目录）时逐文件**串行**转换，避免同时拉起一堆解释器；结果按「一行一个文件」汇总，只有单个文件才给详细输出。

传目录时，返回值总会附带一条「目录展开」说明：是否递归、扫到几个文件、挑出几个 Office / PDF、跳过几个非 Office 文件、有哪些子目录没进去 —— 即使只挑出 1 个文件也会说明，免得「只处理了 1 个文件」被误读成「这个文件夹只有 1 个文件」。

### 纯文本文件

对 `.md` / `.txt` / `.csv` / `.json` 等纯文本，工具会直接告知「无需转换，直接 `read` 最省 token」（`.csv` 如确需 Markdown 表格，可传 `action: "convert"`）。

---

## 技能说明

插件同时注册一份运行时技能，要求模型：

> 遇到 .docx、.xlsx、.pptx、.pdf、.csv 等 Office / PDF 文件时，不要直接读原文件，必须先调用 read_office_as_markdown 工具转换成 Markdown，再读取转换后的 .md 文件。转换结果就在源文件旁边（工作区里），按需读取，避免全文注入上下文。

技能里还写明：**需要装 MarkItDown 时，让用户打开 DSH 设置里的「Office 转换」页面去点一键配置，模型不要自己执行 `pip install`。**

关掉它：`registerSkill: false`。

---

## `read` 守卫

默认开启（`guardReadTool: true`）：当模型试图用 `read` 直接读取 `.docx` / `.xlsx` / `.pptx` / `.pdf` 等二进制文件时，守卫会拒绝。

**如果这个文件其实已经转换过，守卫会直接把那个 `.md` 的绝对路径交给它**，让下一次 `read` 立刻成功；源文件此后有改动时会说明那是较早的产物。

换成别的路径读同一个文件**不能**绕过守卫，正确做法是关闭 `guardReadTool`。纯文本文件不受影响。

---

## 设置页：Office 转换

在 DSH 的 **设置** 里，左侧多一项 **Office 转换**（`settings.section`，order 450；关闭插件后这一项会一起消失）。页面分五块：

| 区块 | 作用 |
| --- | --- |
| **当前转换器** | 一眼看出现在用的是 🟢 **本机 MarkItDown**（高保真）还是 🟡 **内置兜底**（保真度有限），并列出完整转换链 |
| **Python 环境** | 点「检查本机环境」逐个列出候选解释器：路径、来源（DSH 自带 / 系统 PATH）、有没有 `pip`、有没有装 `markitdown`（含版本）、哪个是当前生效的。可用下拉框指定「装到哪一个」。探测是**并发**做的，每个解释器另有独立超时预算，卡死的会标成「⏱ 未响应」而不是拖住页面；结果按 `probeTtlMs` 缓存，旁边有「重新检查」可强制重探 |
| **一键配置 MarkItDown 环境** | 对选中的解释器执行 `pip install "markitdown[all]"`。安装**前**记录 `pip freeze`、安装**后**取差集，把「这次新增了哪些包」写进环境记录。**如果这个解释器已经有 MarkItDown，就跳过安装、直接完成登记。** 任务在后台跑，页面实时显示进度日志 |
| **插件配置的环境** | 显示环境记录（哪个解释器、新增 / 登记了哪些包、什么时候、是否有包因被运行时共用而保留），以及「卸载插件配置的环境」按钮 —— 只卸载**记录里属于 MarkItDown 的**那些包 |
| **试转一个文件** | 填一个绝对路径，点「试转」：不进模型、不走缓存，直接在本机跑一遍完整转换链，返回转换器、保真度、体积、行数、tokens、耗时和 500 字预览。产物固定叫 `<文件名>-test.md`，放在源文件旁边（配了 `tmpDir` 就放那里），每次覆盖、不会堆积，也不会被工具误当成缓存结果 |

关掉设置页：`registerSettings: false`。

### HTTP 路由

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