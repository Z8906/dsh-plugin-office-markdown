# 安装

[← 回到 README](../README.md)

## 前置要求

- DeepSeek Harness 已安装，能打开设置页。
- Node ≥ 18（DSH 自带运行时即可，插件只用内置模块，不需要 `npm install`）。
- 方式 1、2 需要网络；完全离线时用方式 3 或 4。
- 想用高保真转换，需要一个 Python 3 解释器 —— **可选**，没有时插件走内置兜底转换器。

## 方式 1：从 GitHub 安装（推荐）

打开 **设置 → 插件 → 安装**，填入下面这一行，回车：

```
github:Z8906/dsh-plugin-office-markdown
```

要锁版本就在末尾加上 tag（`<tag>` 形如 `v1.2.1`）：

```
github:Z8906/dsh-plugin-office-markdown#<tag>
```

装完之后**必须重启 DSH**。这是一个 bundle 插件，DSH 在启动时装载它；
不重启的话插件文件已经在磁盘上，但宿主还没加载它。

## 方式 2：从 Release 的 `.tgz`

在 [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) 里下载
`dsh-plugin-office-markdown-<版本>.tgz`，解压或直接把这个文件的**绝对路径**填进安装框。

目标机器没有 git 时用这条。`.tgz` 里包含 `lib/`、`cordis.patch.yml`、`README.md`、`package.json`、`LICENSE`。

## 方式 3：从本地目录

把仓库克隆或复制到本机，然后在安装框里填本地路径（`file:` 前缀或绝对路径）。

适合要改代码的场景 —— 见 [开发文档](development.md)。

## 方式 4：手工运行 `install.ps1`

仓库根目录的 `install.ps1` 用于不走设置页的安装。它的参数：

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `-ProfileDir` | `~\.dsh\profiles\desktop` | 要装进哪个 profile |
| `-SourceDir` | 脚本所在目录 | 从哪里复制文件 |
| `-SkipCopy` | — | 只改配置，不复制文件 |
| `-SkipEnv` | — | 不碰 Python 环境相关逻辑 |
| `-Disabled` | — | 装成禁用状态 |
| `-RegisterBundle` | — | 把插件写进 profile 的 `bundles` 列表 |
| `-KeepMarkitdown` | — | 卸载时保留 markitdown 包 |
| `-KeepRemovalLog` | — | 卸载时保留清理日志 |
| `-Uninstall` | — | 执行卸载而不是安装 |

例：

```powershell
.\install.ps1 -RegisterBundle
```

## 升级

**不要走「设置页卸载 → 重新安装」。** 本插件在**真正被卸载**时会清理它自己登记过的
Python 包（[卸载文档](uninstall.md) 说明了判定过程），所以那条路的结果是
「插件更新到新版了，Python 环境却没了」。

正确的做法是二选一：

```powershell
pnpm update dsh-plugin-office-markdown
```

或者直接在安装框里再 add 一次同一个 git 地址，然后重启 DSH。

## 验证装好了

1. **设置 → 插件**：列表里能看到 `dsh-plugin-office-markdown`，版本号与预期一致。
2. **设置 → Office 转换**：能看到「当前转换器」和本机 Python 环境探测结果。
   （profile 没有 `webServer` 服务时不会有这一页，属于正常现象。）
3. 让模型读一个 `.xlsx`，观察它是不是先调用了转换工具。

## 卸载

见 **[卸载文档](uninstall.md)**。

---

> 本文档主要由 AI 生成，配置项与行为对照过源码，但仍可能与实现有出入。
> 说明与免责见 [README 的「关于本文档」](../README.md#关于本文档)。