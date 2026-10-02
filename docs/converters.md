# 转换器与保真度

[← 返回首页](../README.md) ｜ [安装](installation.md) · [使用](usage.md) · [配置](configuration.md)

---

## 转换器链

按顺序探测，**第一个可用的胜出**：

| 顺序 | 转换器 | 保真度 | 依赖 |
| --- | --- | --- | --- |
| 1 | `uvx markitdown`（临时运行，无需永久安装） | 高 | 需要 `uv` + 网络（首次） |
| 2 | 本机 `markitdown` 命令 | 高 | 已安装 markitdown |
| 3 | `python -m markitdown` | 高 | Python + markitdown |
| 4 | 内置 **Python** 兜底（`lib/fallback.py`） | 有限 | 任意 Python 3；可选 python-docx / openpyxl / python-pptx / pypdf |
| 5 | 内置 **Node** 兜底（`lib/fallback-node.js`） | 有限 | **无**：只用 Node 内置 `zlib`，不需要 Python，不需要网络 |

第 4、5 级只在前三级全部不可用时才使用，并且结果文件开头会写入 `fidelity=limited` 标记，工具返回里也会说明「保真度有限」。反过来，如果缓存里那份就是兜底产物、而现在这台机器已经有 MarkItDown，插件会重新转换一次把它升级掉。

---

## 没有 Python、没有网络时怎么办

**仍然可用** —— 一级都不需要装：

- 第 5 级 `fallback-node.js` 随插件打包，直接用 DSH 自带的 Node 在**当前进程内**解析 OOXML（`.docx` / `.xlsx` / `.pptx` 本质是 zip + xml）：内置 `zlib` 解压、正则抽取文字与表格，全程离线、零依赖。
- **支持**：`.docx` `.docm` `.xlsx` `.xlsm` `.pptx` `.pptm`。
- **不支持**（会给出明确中文提示，而不是静默失败）：`.pdf`、旧版二进制 `.doc` `.xls` `.ppt`、`.msg` `.epub` `.odt` `.ods` `.odp`。这些需要 MarkItDown 或本机 Python 兜底。
- 关于 Python：装了 DSH 的电脑通常已带一个运行时 Python，插件会自动发现 `%USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\python\python.exe`；如果该 Python 里同时装了 `python-docx` / `openpyxl` / `python-pptx` / `pypdf`，第 4 级兜底也能用（PDF 会尝试 `pypdf` → `PyPDF2` → `pdfminer`，最后还有一个极简流解析）。

---

## 升级到最高保真度：安装 MarkItDown

第 1~3 级才是真正的 MarkItDown。**任意一级可用后插件会自动切过去，不需要改配置，也不需要重启 DSH**；探测结果有 10 分钟缓存（`probeTtlMs`），想立刻生效就调用一次工具并传 `action: "status"`（强制重探），或在设置页点「重新检查」。

### 推荐：在设置页一键配置

1. 打开 **设置 → Office 转换**；
2. 在「Python 环境」区块点 **检查本机环境**，确认候选列表；
3. 需要的话用下拉框选一个解释器（默认帮你选中第一个「有 pip」的）；
4. 点 **一键配置 MarkItDown 环境**，等进度日志跑完。

装完之后：

- 插件会自动切到 `python -m markitdown`（高保真）；
- 会写下环境记录，「插件配置的环境」区块能看到新增 / 登记了什么，随时可以一键卸载，**在 DSH 里卸载插件时也会自动清掉**；
- 如果那个解释器本来就已经有 MarkItDown，第 4 步会跳过安装、直接登记，显示「已接管（原本已安装）」；
- **没登记过的 markitdown（例如你在别的 Python 环境里 `pip install` 的）不会被记录，也永远不会被插件卸载。**

### 手工安装（等价做法）

> 手工装的 markitdown **不会被自动登记**。想让插件在卸载时帮你收拾，装完请回设置页点一次「一键配置」完成登记。

```powershell
# 1) DSH 自带的 Python（推荐，插件在 pythonPrefer: auto 下优先命中）
& "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" -m pip install "markitdown[all]"

# 2) 或者系统里的 Python
pip install "markitdown[all]"
```

`markitdown[all]` 约 90 MB：`magika` + `onnxruntime` 负责文件类型识别，`pdfminer.six` / `pdfplumber` 负责 PDF，`mammoth` 负责 docx，`xlrd` 负责旧版 `.xls`，`markdownify` 负责 HTML。

装完自检：

```powershell
& "<上面的 python.exe>" -m markitdown --help
```

- `markitdown.exe` 会落在 `<python>\Scripts\`，**不必加进 PATH** —— 插件走的是 `python -m markitdown`。
- 只装到系统 Python 也能被找到，但插件会先试 DSH 自带的那个；两个都装了则优先用自带的。
- 想「临时用、不永久安装」就装 [uv](https://docs.astral.sh/uv/)：插件会优先走 `uvx --from "markitdown[all]" markitdown`，用完即走。

---

## 多个 Python 环境：插件会用哪一个

一台机器上通常有三类 Python：**DSH 自带运行时**、**系统 PATH 上的 Python**、以及你在 `pythonPath` 里手动指定的解释器。插件会按顺序对每个候选执行 `-m markitdown --help`，**第一个装了 markitdown 的胜出**。

默认顺序（`pythonPrefer: auto`）：

1. `pythonPath` 指定的解释器
2. `~/.dsh/dsh-runtimes/*/dependencies/python/python.exe`（DSH 自带运行时）
3. `python` → `python3` → `py -3`（系统 PATH）

想看清「到底哪个环境装了 markitdown」，调用一次（**不需要传 `path`**）：

```
read_office_as_markdown({ action: "status" })
```

它会强制重新探测并逐个列出，`✅ 使用中` 就是当前真正在用的那个：

```
🐍 Python 环境（pythonPrefer：auto；按此顺序探测，第一个装了 markitdown 的胜出）
  ✅ 使用中  C:\Users\...\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe   [DSH 自带运行时]
  ❌ 未安装  python   [系统 PATH]  ← D:\path\to\python.exe: No module named markitdown
  ❌ 未安装  python3  [系统 PATH]  ← Python was not found; ... Microsoft Store ...
  ❌ 未安装  py       [系统 PATH]  ← D:\path\to\python.exe: No module named markitdown
```

要固定用某一个，两种办法：

- **精确指定**：`pythonPath: 'D:\path\to\python.exe'` —— 只试这一个，试不通就直接进兜底。
- **只换顺序**：`pythonPrefer: bundled`（只用 DSH 自带）/ `system`（系统 PATH 优先）/ `config`（只用 `pythonPath`）。某种模式无法满足时会自动退回 `auto`，不会让插件失去解释器。

安装建议：**装到 DSH 自带 Python 最省事**（设置页默认也是往它装）；只装到系统 Python 也能被找到，但把 `pythonPrefer` 设为 `system`、或用 `pythonPath` 指过去更稳妥。

---

## 保真度标记

每份产物的第一行记录它是谁转的：

```
<!-- dsh-office-markdown converter=python-module fidelity=high at=2026-10-03T01:00:00.000Z srcbytes=5462 srchash=c7753efa1a3f81d8 -->
```

| `converter` | 对应级别 |
| --- | --- |
| `uvx` | 第 1 级 |
| `markitdown-cli` | 第 2 级 |
| `python-module` | 第 3 级 |
| `builtin` | 第 4 级（`fidelity=limited`） |
| `node-builtin` | 第 5 级（`fidelity=limited`） |

命中缓存时插件从这一行读回**真实的**转换器与保真度，而不是无条件声称「高保真」。由 1.1.x 生成的旧产物没有这一行，会被如实报告为「保真度未知」，传 `force: true` 重转一次即可补上。