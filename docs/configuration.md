# 配置

[← 返回首页](../README.md) ｜ [转换器](converters.md) · [产物与文件](artifacts.md) · [卸载](uninstall.md)

写在 `cordis.patch.yml` 受管块的 `config:` 下（也可通过 DSH 插件管理的配置界面改）。

---

## 全部配置项

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

## 常用组合

**只想省 token，不装任何东西**（默认配置就是）：`converter: auto` + `fallbackEnabled: true` —— 有 MarkItDown 就用，没有就走内置兜底。

**完全离线、绝不联网**：

```yaml
config:
  enabled: true
  allowUvxDownload: false     # 不下载 uvx
  converter: node-builtin     # 只用随包兜底
```

**产物集中管理**：

```yaml
config:
  enabled: true
  tmpDir: '.md-out'           # 相对工作区；产物不再散落在源文件旁边
  pruneStaleArtifacts: true   # 每次转换顺手清掉同一源文件的旧产物
```

> 换成 `tmpDir` 之后，之前生成在源文件旁边的 `.md` 不会被自动迁移或删除 —— 日志里会标注旧路径，需要的话手工清理。

**严格只读、不碰工作区**：把 `guardReadTool` 保持 `true`，并给产物指定一个统一目录（上面的 `tmpDir`），再配合工作区的 `.gitignore`。

**固定用系统 Python**：

```yaml
config:
  enabled: true
  pythonPrefer: system
```

**不想让插件碰 Python 环境**：

```yaml
config:
  enabled: true
  autoAdoptEnv: false
  removeEnvOnUninstall: false
```