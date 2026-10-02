# 开发

[← 回到 README](../README.md)

## 包内文件

插件是一个 **bundle 插件**：DSH 通过 `cordis.patch.yml` 把它挂进 profile，入口是 `lib/index.js`。
仓库里被跟踪的文件如下（`git ls-files`）：

```
.github/workflows/ci.yml
.github/workflows/release.yml
.gitignore
CHANGELOG.md
LICENSE
README.en.md
README.md
cordis.patch.yml
docs/*.md
install.ps1
lib/client.js
lib/convert.js
lib/env.js
lib/fallback-node.js
lib/fallback.py
lib/index.js
lib/paths.js
lib/removal-watchdog.js
lib/settings-api.js
package.json
```

各模块职责：

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 插件入口：`DEFAULTS`、工具注册、技能注册、`read` 守卫、卸载判定 |
| `lib/convert.js` | 转换器链：探测、选择、执行、元信息写入 |
| `lib/env.js` | Python 环境发现、登记（`*.env.json`）、安装 / 卸载 |
| `lib/settings-api.js` | 设置页的 HTTP 路由 |
| `lib/client.js` | 设置页前端 |
| `lib/paths.js` | 路径拼装 |
| `lib/fallback.py` | 内置 Python 兜底转换器 |
| `lib/fallback-node.js` | 内置 Node 兜底转换器（只依赖 Node 内置模块） |
| `lib/removal-watchdog.js` | 卸载时的清理进程（单实例锁、日志压缩） |

## 本地开发

1. 克隆仓库。
2. 用 `install.ps1 -SkipCopy` 之类的方式把本目录挂进 profile，或者直接在安装框里填本地路径。
3. 改完 `lib/` 下的文件后重启 DSH。`lib/client.js` 是设置页前端，
   改动后刷新设置页即可生效。

依赖只有一个宿主提供的包：`@deepseek-ai/dsh-tools`（用它的 `defineTool`）。
这是因为动态 import + 顶层 await 会让模块命名空间变成异步的，DSH 的加载器就会太晚才拿到插件对象，
入口会静默地激活失败 —— 所以这里用静态 import。

## 发布

1. 改 `package.json` 的 `version`。
2. 在 `CHANGELOG.md` 顶部加一节，标题格式为 `## [<版本>] - <日期>`。
   `.github/workflows/release.yml` 用它来生成 Release 说明：从 `## [<tag>]` 那一行开始取，
   到下一个 `## [` 开头的行为止，所以版本标题的格式不能改。
3. 提交并打 tag：`git tag -a v<版本> -m "v<版本>"`，然后推 tag。
   用**附注标签**（`-a`），与仓库里已有的 5 个 tag 保持一致；`git tag v<版本>`（不带 `-a`）造出的是轻量标签。
4. `release.yml` 在 tag 上触发：打包 `.tgz`，用 `gh release create` 建 Release 并附上说明与 tarball。
   `ci.yml` 负责常规检查。
   注意：**强制更新一个已存在的 tag 不会触发 `release.yml`** —— 只有新增 tag 才会。

### 发版检查清单

**必须改**（只有这两处）：

- [ ] `package.json` 的 `version`
- [ ] `CHANGELOG.md` 顶部新增 `## [x.y.z] - YYYY-MM-DD` 小节
      —— Release 说明由它自动生成，**不要手写 Release 正文**

**通常不用动**：

- Release 正文：tag 推送后由 `release.yml` 从 `CHANGELOG.md` 生成。
- 仓库 About 的 description / topics：与版本号无关。
- `README.md` / `README.en.md` / `docs/`：安装示例统一写成 `#<tag>` 占位符，
  不含写死的版本号，所以正常发版不需要回来改。
- `install.ps1`、`lib/`：除非本次真的有对应改动。

**顺带检查**：

- [ ] 新增或删除文件后，本章的「包内文件」清单（来源 `git ls-files`）与
      `package.json` 的 `files` 白名单是否仍然准确。
- [ ] 新版本若改变了行为，对应的 `docs/*.md` 是否同步更新 ——
      文档里不写没有实测依据的数字。

`package.json` 的 `files` 白名单决定了 `.tgz` 的内容：`lib/`、`cordis.patch.yml`、`README.md`
（外加 npm 总会带的 `package.json` 与 `LICENSE`）。因此 `docs/` 与 `README.en.md`
**不在** npm 包里 —— 它们面向 GitHub 阅读。

## 代码约定

- **只用 Node 内置模块**。不引入 npm 依赖是这个插件的一个明确卖点，提 PR 时请保持。
- 每个写到磁盘上的文件都要能在卸载时被干净地收尾。
- Javascript 源码中用中文注释与中文用户可见文本，与现有风格一致。

---

> 本文档主要由 AI 生成，文件清单来自 `git ls-files`，发布流程对照过
> `.github/workflows/release.yml`。
> 说明与免责见 [README 的「关于本文档」](../README.md#关于本文档)。