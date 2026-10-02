# 转换器

[← 回到 README](../README.md)

## 转换器链

插件按顺序探测，第一个可用的胜出。下表对照 `lib/convert.js`：

| 顺序 | 转换器 | 保真度 | 需要 |
| --- | --- | --- | --- |
| 1 | `uvx markitdown` | 高 | `uv` + 网络（首次会下载） |
| 2 | 本机 `markitdown` 命令 | 高 | 已安装 markitdown |
| 3 | `python -m markitdown` | 高 | Python + markitdown |
| 4 | 内置 Python 兜底（`lib/fallback.py`） | 有限 | 任意 Python 3 |
| 5 | 内置 Node 兜底（`lib/fallback-node.js`） | 有限 | 无 |

第 1 级受 `allowUvxDownload` 控制，第 4、5 级受 `fallbackEnabled` 控制。
用 `converter` 配置项可以直接指定某一级，跳过探测。

## 内置 Node 兜底

**第 5 级不需要 Python，也不需要网络。** 它用 Node 内置的 `zlib` 直接解析 OOXML ——
`.docx` / `.xlsx` / `.pptx` 本身就是 zip + xml 容器。

- 支持：`.docx` `.docm` `.xlsx` `.xlsm` `.pptx` `.pptm`
- 不支持：`.pdf`，以及旧版二进制格式（`.doc` `.xls` `.ppt`）

保真度有限：能拿到文字、表格、幻灯片文本，但复杂的样式、图表、嵌入对象会有损失。
它存在的意义是「一台什么依赖都没有的机器上也能用」。

## 内置 Python 兜底

第 4 级用 `lib/fallback.py`。有若干可选库装在同一个解释器里时效果更好，
缺了也能跑，只是保真度打折。具体装了哪些会影响输出，以实测为准。

## 产物会记录真实的转换器

每份产物的第一行是：

```
<!-- dsh-office-markdown converter=python-module fidelity=high at=<时间> srcbytes=<字节数> srchash=<哈希> -->
```

命中缓存时，插件从这一行读回**当时真正用的**转换器和保真度，而不是无条件声称「高保真」。
这也意味着手动改了产物内容不会影响这个记录，但改了源文件会让缓存失效（靠 `srchash`）。

## 多个 Python 环境怎么挑

`pythonPrefer` 决定探测顺序：`auto` / `bundled` / `system` / `config`。
想固定用某一个解释器，把它的绝对路径填进 `pythonPath`，并把 `pythonPrefer` 设为 `config`。
设置页的「本机 Python 环境探测」会列出所有候选以及各自是否装了 markitdown。

## 装 MarkItDown

打开 **设置 → Office 转换**，点「一键配置 MarkItDown 环境」，在页面上选装到哪个解释器。

**插件的安装脚本不会替你装任何 Python 包**，只有你在设置页上点了按钮才会执行
`pip install "markitdown[all]"`，装了什么会记进插件自己的环境记录，卸载时按这份记录精确清理。

想手工装也可以，用目标解释器执行：

```powershell
python -m pip install "markitdown[all]"
```

装完回到设置页点一次探测，就能看到它被识别。

`markitdown[all]` 会带来一批 Azure / PDF / 音频相关的依赖包，体积不小，
这也是插件把它做成可选、并且卸载时要精确清理的原因。

---

> 本文档主要由 AI 生成，转换器链与取值对照过 `lib/convert.js`。
> 说明与免责见 [README 的「关于本文档」](../README.md#关于本文档)。