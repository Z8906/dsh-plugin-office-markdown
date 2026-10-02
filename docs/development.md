# 开发

[← 返回首页](../README.md) ｜ [安装](installation.md) · [配置](configuration.md) · [故障排查](troubleshooting.md)

---

## 包内文件

```
dsh-plugin-office-markdown/
├── package.json          # dsh.bundle.patch → cordis.patch.yml；dsh.client → lib/client.js
├── cordis.patch.yml      # 供 bundle 方式安装时使用的 insert 条目
├── README.md             # 中文主 README
├── README.en.md          # 英文镜像
├── LICENSE               # MIT
├── CHANGELOG.md          # 版本更新日志（不进 .tgz）
├── docs/                 # 详细文档（不进 .tgz）
├── install.ps1           # 安装 / 卸载脚本（不进 .tgz；Releases 的 .zip 源码快照里有）
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

**`.tgz` 内容**由 `package.json` 的 `files` 白名单（`lib`、`cordis.patch.yml`、`README.md`）加 npm 自动包含的 `package.json` / `LICENSE` 决定；`install.ps1`、`CHANGELOG.md`、`docs/`、`.github/` 都**不在**包内。

---

## 实现要点

- **Node**：仅使用内置模块（`fs` / `path` / `os` / `zlib` / `crypto` / `child_process` / `string_decoder`），**没有任何 npm 依赖**，不需要 `npm install`。
- **Python 兜底**：只用标准库 + 可选 `python-docx` / `openpyxl` / `python-pptx` / `pypdf`。
- 除 `@deepseek-ai/dsh-tools`（由 DSH 自身提供，用于 `defineTool`）外不 import 任何宿主包。
- `apply()` 的全部注册都包在 `ctx.effect(...)` 里，禁用或卸载时会被干净回收；`webServer` 是可选服务，通过 `ctx.inject(['webServer'], ...)` 注册路由 —— CLI profile 缺这个服务时，只有设置页不出现，工具与技能照常工作。
- `client.js` 是手写的 `window.__ModuleLoader__.load({...})` 模块，只用 `require("react")`，不依赖任何 DSH 内部 UI 包，也不依赖任何 CSS 类（样式全内联，明暗主题都能用）。
- 卸载时的环境清理走 `ctx.effect(() => () => scheduleRemovalCleanup(...))`：先按 [卸载文档](uninstall.md) 的判定顺序区分「被卸载」和「被禁用 / 关闭 / 重启」，只有确认是被卸载时才通过 `lib/removal-watchdog.js` 派发一个**脱离宿主的 Python 进程**（`detached` + `unref`，不拖住宿主退出），由它轮询确认后再执行 `uninstallMarkitdown()`。
- `lib/paths.js` 集中解析 DSH 数据目录，三级回退：`ctx.get('profileContext').dir` 反推（`<home>/profiles/<name>` → `<home>`）→ 环境变量 `DSH_HOME` → `~/.dsh`。插件从不引用 DSH 的**安装**目录，换机器、换安装路径都不受影响。

---

## 本地开发

本项目**主要由 DeepSeek 开发**。Issue 与 PR 都欢迎 —— 尤其是转换失败的文件样本（脱敏后）。

```powershell
git clone https://github.com/Z8906/dsh-plugin-office-markdown.git
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& ".\dsh-plugin-office-markdown\install.ps1" -RegisterBundle
# 重启 DSH
```

- 改 `lib/*.js`（宿主半边）之后**必须重启 DSH**（Node ESM 缓存不会重新 import）。
- 改 `lib/client.js`（设置页界面）会被 HMR 热替换，刷新页面即可。
- 改了 `lib/` 又用 `file:` tarball 分发时，记得先升 `package.json` 的 `version` —— pnpm 按「路径 + 版本号」缓存，版本没变会直接复用旧包。
- `install.ps1 -SkipCopy` 可以只跑环境探测 / 受管块部分，不复制文件（改脚本时方便）。

---

## CI 与发布

仓库有两个工作流：

| 工作流 | 触发 | 做什么 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR | `node --check` 语法检查、tag 与 `package.json` 版本号一致性、`npm pack` 后确认 `.tgz` 顶层目录是 `package/` 且关键文件齐全 |
| `.github/workflows/release.yml` | 推 `v*` tag | 从 `CHANGELOG.md` 提取对应小节作为 Release 说明，创建 Release 并上传 `.tgz` |

发布步骤：

1. 改代码，升 `package.json` 的 `version`；
2. 在 `CHANGELOG.md` 顶部按 `## [x.y.z] - 日期` 的写法加一节（**这个标题格式必须保留**，`release.yml` 靠它提取说明；已发布版本的标题也不要改）；
3. `git commit` && `git push`；
4. `git tag -a vX.Y.Z -m "..."` && `git push origin vX.Y.Z`；
5. Release 会自动建好并带上 `.tgz`。

> Release 的说明文字用 `gh release create --notes-file` 传入，避免中文在 Windows 上被写坏。

---

## 许可证

[MIT](../LICENSE) © 2026 dsh-plugin-office-markdown contributors