# 安装

[← 返回首页](../README.md) ｜ [使用](usage.md) · [转换器](converters.md) · [配置](configuration.md)

四条路，按「目标机器有没有 git」「需不需要 `install.ps1`」来选。**无论走哪条，装完都要重启 DSH。**

---

## 方式 1：在 DSH 安装框里填一行（推荐）

打开 DSH 的 **设置 → 插件 → 安装**，填入下面这行，回车：

```
github:Z8906/dsh-plugin-office-markdown
```

它会作为 bundle 装进 profile —— **设置 → 插件** 里能看到它、也能一键卸载。

| 想要什么 | 填什么 |
| --- | --- |
| 跟最新主干 | `github:Z8906/dsh-plugin-office-markdown` |
| 锁定某个版本 | `github:Z8906/dsh-plugin-office-markdown#v1.2.1` |
| 装历史版本 | 把 `#v1.2.1` 换成 `#v1.1.1` / `#v1.1.0` / `#v1.0.0`（**均不推荐**，见[更新日志的版本一览](../CHANGELOG.md)） |

- 这条路**要求目标电脑装了 git**（DSH 安装前会先跑一次 `git ls-remote` 预检），并且仓库公开 —— 本仓库两条都满足。
- 目标电脑**没有 git**？用方式 2 或方式 3。

---

## 方式 2：下载 `.tgz` 安装（不需要 git）

从 [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) 下载 `dsh-plugin-office-markdown-<版本>.tgz`，在 DSH 的安装入口里**填它的绝对路径**。

也可以手工装：把 tarball 放到固定位置（例如 `%USERPROFILE%\.dsh\local-packages\`），在 `<profile>\package.json` 里改两处，然后在 `<profile>` 目录下执行 `pnpm install`：

```json
{
  "dsh": { "profile": { "bundles": [ "……", "dsh-plugin-office-markdown" ] } },
  "dependencies": {
    "……": "……",
    "dsh-plugin-office-markdown": "file:../../local-packages/dsh-plugin-office-markdown-1.2.1.tgz"
  }
}
```

> **`.tgz` 里有什么**：`package.json`、`cordis.patch.yml`、`README.md`、`LICENSE`、`lib/`（9 个文件）。
> 它**不含 `install.ps1`**，也不含 `CHANGELOG.md`、`docs/`、`.github/`（这些不在 `package.json` 的 `files` 白名单里）—— 需要 `install.ps1` 请走方式 3。
>
> **`file:` 依赖的缓存规则**：pnpm 按「路径 + 版本号」缓存 `file:` 依赖 —— 内容变了但版本号没变时会直接复用缓存（安装输出里写 `reused`）。所以改完 `lib/` 必须先把 `package.json` 的 `version` 升一位，再重新打包、复制、重装。

---

## 方式 3：源码 + `install.ps1`

`install.ps1` 只存在于源码里（`.tgz` 不含它）。拿到源码有两条路：

- 从 [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) 下载 `dsh-plugin-office-markdown-v<版本>.zip` —— 源码快照，**内含 `install.ps1`**，解压后就是 `dsh-plugin-office-markdown-<版本>\` 目录，**不需要 git**；
- 或 `git clone` 本仓库（含全部历史）：

```powershell
git clone https://github.com/Z8906/dsh-plugin-office-markdown.git
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& ".\dsh-plugin-office-markdown\install.ps1"
```

脚本只做三件事：

1. 把插件复制到 `<profile>\node_modules\dsh-plugin-office-markdown`；
2. **只看不装**：逐个探测本机 Python 解释器（DSH 自带运行时 → 系统 PATH → `py -3`），打印每个有没有 `pip`、有没有装 `markitdown`，并告诉你重启后插件会实际用哪一个；
3. 在 `<profile>\cordis.patch.yml` 末尾写入受管块（`# >>> dsh-plugin-office-markdown` … `# <<< dsh-plugin-office-markdown`）。改文件前备份成 `cordis.patch.yml.bak`（**固定文件名，每次覆盖，不会累积时间戳备份**）。

> **想要「插件」页里的卸载按钮**，加上 `-RegisterBundle`：脚本会打成 tarball 放进 `<DSH 数据目录>\local-packages\`、在 profile `package.json` 里同时登记 `dsh.profile.bundles` 与 `dependencies` 的 `file:` 指向、用 DSH 自带的 pnpm 跑一次 `install`，最后移除它先前写的 `cordis.patch.yml` 受管块（bundle 自带一份，留着会被加载两次）。

```powershell
# 一键装成正规 bundle（「插件」页可见、可一键卸载）
& "<解压路径>\dsh-plugin-office-markdown\install.ps1" -RegisterBundle

# 完全不调用任何 Python（离线安装 / 只想复制文件）
& "...\install.ps1" -SkipEnv

# 装上但先禁用（等价于没装）
& "...\install.ps1" -Disabled

# profile 名不是默认的 desktop
& "...\install.ps1" -ProfileDir "C:\Users\你\.dsh\profiles\<你的 profile>"
```

> **脚本不会自动 `pip install` 任何东西。** 要装 MarkItDown，重启 DSH 后打开 **设置 → Office 转换**，点「一键配置 MarkItDown 环境」，装到哪个解释器由你当场选。这样离线机器、或已经自己装好的机器，都不会被脚本擅自改动 Python 环境。
>
> 直接双击 `.ps1` 会被「禁止运行脚本」拦下；上面第一行只在当前进程内放开，不改变系统全局策略。

---

## 方式 4：手动安装（完全不用脚本）

1. 把整个 `dsh-plugin-office-markdown` 目录复制到 `<profile>\node_modules\dsh-plugin-office-markdown`；
2. 编辑 `<profile>\cordis.patch.yml`，在**文件末尾**追加：

```yaml
- insert:
    - id: office-markdown
      name: dsh-plugin-office-markdown
      config:
        enabled: true
```

> 只需追加一份；`cordis.patch.yml` 是顶层 YAML 数组。若脚本已经写过受管块，不要再手写第二份。

---

## 安装后必须做的一步：重启 DSH

两个原因：

- DSH 会热加载 `cordis.patch.yml` 的配置改动，但**不会重新 import 已经加载过的插件模块**（Node ESM 缓存）。首次安装、以及每次改 `lib/*.js` 之后，都必须重启。
- `dsh.client` 声明（设置页）只在启动时扫描一次，宿主必须重新扫描已启用的条目才会加载客户端半边。

首次重启之后，再改 `lib/client.js`（设置页界面）能被 HMR 热替换，不必再重启；改 `lib/*.js` 的宿主半边仍然要重启。

---

## 验证安装

- 打开 **设置 → Office 转换**：能看到当前转换器、本机 Python 环境、一键配置 / 一键卸载；如果 DSH 自带运行时里已经有 MarkItDown，会显示「已接管（原本已安装）」。
- 在工作区放一个 `.docx` 或 `.xlsx`，对 DSH 说「读取并总结这个文件」：应先调用 `read_office_as_markdown` 生成 `.md`，再读该 `.md`。
- 或直接要求：「用 `read_office_as_markdown` 查看 status」，会列出当前可用的转换器链。

---

## 升级

**DSH 没有升级按钮。** 本插件的正确升级方式是下面任一条，然后**重启 DSH**：

1. **推荐**：让 pnpm 重新解析这个 git 依赖（在工作区 shell 里，用 DSH 自带的 pnpm）：

```powershell
$rt = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies"
& "$rt\node\bin\node.exe" "$rt\pnpm\bin\pnpm.mjs" update dsh-plugin-office-markdown --dir "$env:USERPROFILE\.dsh\profiles\desktop"
```

2. 或者在 **设置 → 插件 → 安装** 里**再 add 一次同一条 git 地址**（不碰「卸载」）。
3. 或者直接覆盖安装目录：`pnpm pack` 出 `.tgz` → 解包 → 复制进 `<profile>\node_modules\dsh-plugin-office-markdown`（**覆盖式复制不会删除多余文件**，若旧版有已删除的文件，建议先手工删掉那个目录）。

> ⚠️ **不要**走 DSH 界面上的「卸载 → 重新安装」。本插件在真正被卸载时会清理它登记的 Python 环境（[设计如此](uninstall.md)），那条路会把环境清掉再重装 —— 结果是插件升级了、Python 环境却没了。
>
> 如果已经这么做了：重启后打开 **设置 → Office 转换**，点「一键配置 MarkItDown 环境」把环境装回来即可。

升级后：

- 由 **1.1.x 生成的旧产物没有标记行**，工具会如实报告「保真度未知」；传 `force: true` 重转一次即可补上 `converter=` / `fidelity=` 标记。
- 旧版的环境记录 `~/.dsh/dsh-plugin-office-markdown.env.json` 继续有效，不需要重装 Python 环境。