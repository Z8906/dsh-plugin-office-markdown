<h1 align="center">dsh-plugin-office-markdown</h1>

<p align="center"><a href="./README.md">中文</a> | <a href="./README.en.md">English</a></p>

<p align="center"><strong>Convert Office / PDF to Markdown before reading it</strong><br><em>One file path instead of the whole document.</em></p>

<p align="center"><sub>docx · xlsx · pptx · pdf · csv ｜ 0 npm dependencies ｜ conversion stays local ｜ artifact lands next to the source ｜ uninstall cleans up the Python env</sub></p>

<p align="center">
  <a href="https://github.com/Z8906/dsh-plugin-office-markdown/releases"><img src="https://img.shields.io/github/v/release/Z8906/dsh-plugin-office-markdown?style=flat-square&color=5786FE&label=release" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen?style=flat-square" alt="Node"></a>
  <img src="https://img.shields.io/badge/npm%20deps-0-brightgreen?style=flat-square" alt="0 npm deps">
  <img src="https://img.shields.io/badge/DSH-bundle%20plugin-5786FE?style=flat-square" alt="DSH bundle plugin">
  <a href="https://github.com/Z8906/dsh-plugin-office-markdown/stargazers"><img src="https://img.shields.io/github/stars/Z8906/dsh-plugin-office-markdown?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <a href="https://www.deepseek.com" title="deepseek-harness (dsh)"><img src="https://cdn.simpleicons.org/deepseek/5786FE" height="26" alt="deepseek-harness"></a>
</p>

<p align="center">
  <a href="docs/installation.md">Install</a> ·
  <a href="docs/usage.md">Usage</a> ·
  <a href="docs/converters.md">Converters</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="docs/uninstall.md">Uninstall</a> ·
  <a href="docs/troubleshooting.md">Troubleshooting</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

When a model reads a `.docx` / `.xlsx` / `.pptx` / `.pdf`, the whole file is poured into the context: a 36 KB `.docx` is roughly thirty thousand tokens, while the actual content may be a few hundred words. This plugin splits reading into two steps — **convert to Markdown locally, then read that `.md` on demand**.

```
report.xlsx (36 KB)  ──▶  local conversion  ──▶  report-a1b2c3d4.md (0.5 KB)  ──▶  read on demand
                          MarkItDown or built-in fallback      source file untouched
```

The same content, from ~30k tokens down to a hundred-odd.

> **Detailed docs are currently Chinese-only.** The links below go to the Chinese docs; the entry points and behavior described here are complete enough to install and use the plugin.

## Why

- **Token savings are the point**: one file path (~40 tokens) instead of the whole document.
- **Conversion stays local**: no network (except the first `uvx` download), never modifies the source file, never spends API budget.
- **Works without Python**: the built-in Node fallback unpacks OOXML with `zlib` alone — zero dependencies, zero installation, fully offline.
- **The artifact is yours**: the `.md` is written **next to the source file**, and the plugin never deletes it on its own.
- **No forced reads**: an optional `read` guard blocks direct reads of binary Office files and hands back the path of the `.md` that already exists.
- **Clean uninstall**: removing the plugin in DSH `pip uninstall`s the MarkItDown and dependencies it installed itself; **packages shipped with DSH and packages you installed are left alone**.
- **Zero residue**: apart from that `.md`, no temp directories, no cache metadata, no `__pycache__` inside the package.

## Compared to reading the original

| | Reading the original | With this plugin |
| --- | --- | --- |
| Context cost | the whole file (36 KB ≈ 30k tokens) | one path ≈ 40 tokens |
| Reading strategy | everything injected | read the first 200 lines for structure, then `grep` |
| Source file | read as if it were text (binary is useless) | blocked by the guard, the `.md` is read instead |
| Artifact | none | one `.md` next to the source, yours |
| Dependencies | none | **0 npm dependencies**; Python optional |

## Install

In DSH, open **Settings → Plugins → Install**, paste one line, press Enter:

```
github:Z8906/dsh-plugin-office-markdown
```

It installs as a bundle into your profile — visible (and one-click uninstallable) under **Settings → Plugins**. **Restart DSH** afterwards.

- To pin a version: `github:Z8906/dsh-plugin-office-markdown#v1.2.1`
- No git on the target machine: use the `.tgz` from [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases) (paste its absolute path into the install box), or the `.zip` source snapshot plus `install.ps1`

All four install routes, the manual route and the upgrade steps: **[installation docs](docs/installation.md)**.

> **Upgrade caveat**: do **not** upgrade through DSH's "uninstall → reinstall". Uninstalling triggers this plugin's own environment cleanup on purpose (see the [uninstall docs](docs/uninstall.md)). Upgrade with `pnpm update`, or add the same git address again in the install box. DSH's own "upgrades need an uninstall first" note holds for ordinary plugins; this one is the exception.

## What it looks like in practice

No commands to remember. Say "read and summarise this xlsx" — the skill registered by the plugin makes the model convert first:

```
read_office_as_markdown({ path: "report.xlsx" })
→ report-a1b2c3d4.md (0.5 KB, 37 lines, ≈115 tokens)
  converter: local MarkItDown (high fidelity)
  outline: Sheet1 · Sheet2 · Totals
  reading advice: read the first 200 lines for structure, then grep within the same .md
```

Only the path, size, line count and structure outline enter the context — **the full text is never injected, and the artifact is never truncated**.

Full tool parameters, settings page and HTTP routes: **[usage docs](docs/usage.md)**.

## Converters and fidelity

Probed in order, first available wins:

| # | Converter | Fidelity | Requires |
| --- | --- | --- | --- |
| 1 | `uvx markitdown` (temporary) | high | `uv` + network (first run) |
| 2 | local `markitdown` command | high | markitdown installed |
| 3 | `python -m markitdown` | high | Python + markitdown |
| 4 | built-in **Python** fallback | limited | any Python 3 (optional libs improve it) |
| 5 | built-in **Node** fallback | limited | **nothing** |

Level 5 ships with the plugin and works with **no Python and no network** (`.docx` / `.xlsx` / `.pptx` are just zip + xml). PDF and legacy binary formats need MarkItDown or level 4.

Every artifact records who produced it on its first line (invisible when rendered):

```
<!-- dsh-office-markdown converter=python-module fidelity=high at=2026-10-03T01:00:00.000Z srcbytes=5462 srchash=c7753efa1a3f81d8 -->
```

On a cache hit the plugin reads the **real** converter and fidelity back from that line instead of claiming "high fidelity" unconditionally; artifacts generated by 1.1.x are honestly reported as "fidelity unknown".

For maximum fidelity, open **Settings → Office conversion** and click "configure MarkItDown environment" (the install script never installs any Python package on its own). Choosing between multiple Pythons, what the fallbacks support, and manual installation: **[converter docs](docs/converters.md)**.

## Documentation

| Doc | Read it when |
| --- | --- |
| [Installation](docs/installation.md) | four routes, manual install, upgrade, verification |
| [Usage](docs/usage.md) | tool parameters, skill, `read` guard, settings page, HTTP routes |
| [Converters](docs/converters.md) | converter chain, fidelity, multiple Pythons, installing MarkItDown |
| [Configuration](docs/configuration.md) | every config key and its default |
| [Artifacts & files](docs/artifacts.md) | where the `.md` goes, what files the plugin leaves behind |
| [Uninstall](docs/uninstall.md) | enable / disable / uninstall, and how the Python env is cleaned |
| [Troubleshooting](docs/troubleshooting.md) | symptoms and FAQ |
| [Development](docs/development.md) | package layout, internals, release process |
| [Changelog](CHANGELOG.md) | what changed in each version |

## Requirements

- **Node ≥ 18**, built-in modules only (`fs` / `path` / `os` / `zlib` / `crypto` / `child_process` / `string_decoder`) — **0 npm dependencies**, no `npm install`.
- **Python and MarkItDown are entirely optional**: with neither, the Node fallback keeps everything working.
- Imports nothing from the host except `@deepseek-ai/dsh-tools` (for `defineTool`).
- DeepSeek Harness only; a profile without `webServer` (CLI profiles) simply has no settings page — tools and skill are unaffected.

## Uninstall

Uninstall it from **Settings → Plugins**. The plugin first confirms it was **really removed** (not disabled, not closed, not restarted), then dispatches a detached watchdog process that uninstalls the Python packages it registered.

**Disabling, closing or restarting DSH never triggers cleanup, and never leaves a resident process behind.** Only a real uninstall does.

Cleanup is strictly limited to its own environment record: packages shipped with the DSH runtime, packages other components depend on, and anything you installed yourself are left untouched. Details: **[uninstall docs](docs/uninstall.md)**.

## Contributing

This project is **developed mainly by DeepSeek**. Issues and PRs are welcome — failed-conversion file samples (redacted) especially.

- Changes to `lib/*.js` need a **DSH restart** (Node ESM cache); `lib/client.js` (the settings page) hot-reloads.
- If you change `lib/` and distribute through a `file:` tarball, bump `package.json`'s `version` first (pnpm caches `file:` deps by path + version).
- Release process and what CI checks: **[development docs](docs/development.md)**.

## Star History

<a href="https://star-history.com/#Z8906/dsh-plugin-office-markdown&Date">
  <img src="https://api.star-history.com/svg?repos=Z8906/dsh-plugin-office-markdown&type=Date" alt="Star History Chart" width="600">
</a>

## License

[MIT](LICENSE) © 2026 dsh-plugin-office-markdown contributors