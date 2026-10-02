# 配置

[← 回到 README](../README.md)

下表对照 `lib/index.js` 里的 `DEFAULTS`（21 个键）。插件读取配置时做的是
`{ ...DEFAULTS, ...config }`，所以没写的键一律用默认值。

| 配置项 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `enabled` | 布尔 | `true` | 总开关 |
| `tmpDir` | 字符串 | `''` | 产物目录；留空表示写在源文件旁边 |
| `converter` | 字符串 | `'auto'` | 指定转换器，见下方取值 |
| `pythonPath` | 字符串 | `''` | 固定使用某个 Python 解释器 |
| `pythonPrefer` | 字符串 | `'auto'` | Python 探测顺序，见下方取值 |
| `allowUvxDownload` | 布尔 | `true` | 允许用 `uvx` 临时拉取 markitdown |
| `uvxExtras` | 字符串 | `'markitdown[all]'` | `uvx` 拉取时带的 extras |
| `fallbackEnabled` | 布尔 | `true` | 允许使用内置兜底转换器 |
| `guardReadTool` | 布尔 | `true` | 拦截直接用 `read` 读二进制 Office / PDF |
| `probeTtlMs` | 数字 | `600000` | 环境探测结果的缓存时长（毫秒） |
| `timeoutMs` | 数字 | `300000` | 单次转换超时（毫秒） |
| `reuseFresh` | 布尔 | `true` | 源文件没变时复用已有产物 |
| `maxPreviewChars` | 数字 | `4000` | `preview` 返回的最大字符数 |
| `maxRowsPerSheet` | 数字 | `400` | 表格类产物每张工作表最多输出多少行 |
| `maxTableCols` | 数字 | `24` | 每行最多多少列 |
| `maxCellsPerSheet` | 数字 | `20000` | 每张工作表最多多少单元格 |
| `pruneStaleArtifacts` | 布尔 | `false` | 每次转换后顺手清理同一源文件的陈旧产物 |
| `registerSkill` | 布尔 | `true` | 注册技能 |
| `registerSettings` | 布尔 | `true` | 注册设置页与 HTTP 路由 |
| `autoAdoptEnv` | 布尔 | `true` | 启动时自动认领已存在的 markitdown 环境 |
| `removeEnvOnUninstall` | 布尔 | `true` | 真正被卸载时清理插件登记过的 Python 包 |

## `converter` 的取值

| 值 | 含义 |
| --- | --- |
| `auto` | 默认。按顺序探测，第一个可用的胜出 |
| `uvx` | `uvx markitdown`，临时运行，不需要永久安装 |
| `markitdown-cli` | 本机的 `markitdown` 命令 |
| `python-module` | `python -m markitdown` |
| `builtin` | 插件内置 Python 兜底转换器 |
| `node-builtin` | 插件内置 Node 兜底转换器（不需要 Python 与网络） |

这些取值来自 `lib/convert.js` 的 `CONVERTER_LABELS`；填了别的值不会生效，
会退回自动探测。转换器链的细节见 [转换器文档](converters.md)。

## `pythonPrefer` 的取值

来自 `lib/convert.js` 的 `PYTHON_PREFERS`：`auto` / `bundled` / `system` / `config`。

- `auto` —— 默认，综合判断。
- `bundled` —— 优先用 DSH 运行时自带的解释器。
- `system` —— 优先用系统里的 Python。
- `config` —— 只用 `pythonPath` 指定的那个。

填了列表以外的值会退回 `auto`；`bundled` 找不到自带解释器、或 `config` 没配
`pythonPath` 时，同样退回 `auto`。

## 关于「常用组合」

这里原先列过几组推荐配置，但那些组合**没有经过验证**，已经删掉。
需要调整时请对照上表的默认值逐项改，改完用设置页的「试转一个文件」实际跑一遍看结果。

---

> 本文档主要由 AI 生成，配置项与默认值逐项对照过 `lib/index.js` 的 `DEFAULTS`。
> 说明与免责见 [README 的「关于本文档」](../README.md#关于本文档)。