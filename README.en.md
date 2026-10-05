<h1 align="center">dsh-plugin-office-markdown</h1>

<p align="center">
  Convert Office / PDF files to Markdown before DeepSeek Harness reads them —<br>
  what enters the model context is a file path, not the raw contents of the document.
</p>

<p align="center">
  <a href="README.md">中文</a> ｜ <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/Z8906/dsh-plugin-office-markdown/releases"><img alt="release" src="https://img.shields.io/github/v/release/Z8906/dsh-plugin-office-markdown?style=flat-square&label=release"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square">
  <img alt="npm" src="https://img.shields.io/npm/v/dsh-plugin-office-markdown?style=flat-square&label=npm">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen?style=flat-square">
  <img alt="npm dependencies" src="https://img.shields.io/badge/npm%20deps-0-brightgreen?style=flat-square">
</p>

<p align="center">
  <a href="#install">Install</a> ｜
  <a href="#usage">Usage</a> ｜
  <a href="#converters">Converters</a> ｜
  <a href="#documentation">Docs</a> ｜
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

> 🤖 **This project's code and documentation are largely AI-generated** — written by a coding agent running
> inside DeepSeek Harness and reviewed by the maintainer before publishing. Config keys, HTTP routes, the
> converter chain and the file list were each **checked against the source**; even so the docs can lag
> behind the implementation — **the code is the reference**. See the [note at the end](#about-this-documentation).

Conversion happens **locally**: no network (except an optional first MarkItDown download), the source
file is never modified, no API budget is spent, and the plugin itself has **zero npm dependencies**.

## Install

In DSH, open **Settings → Plugins → Install**, paste one line, press Enter, then **restart DSH**.

**① From npm (recommended)** — published on npm since 1.2.2:

```
dsh-plugin-office-markdown
```

To pin a version, append `@version`: `dsh-plugin-office-markdown@<version>`, where `<version>` looks like `1.2.2`.

**② From GitHub** — use this when npm is unreachable:

```
github:Z8906/dsh-plugin-office-markdown
```

To pin a tag, append `#<tag>`: `github:Z8906/dsh-plugin-office-markdown#<tag>`, where `<tag>` looks like
`v1.2.2` (see [Releases](https://github.com/Z8906/dsh-plugin-office-markdown/releases)).

**③ Offline / no git** — use the `.tgz` from Releases and paste its **absolute path** into the install box;
a local clone path works too (`file:` prefix or an absolute path).

On the command line, `dsh plugin` forwards its arguments to pnpm inside the profile directory:

```sh
dsh plugin --profile <your profile> add dsh-plugin-office-markdown
```

All install routes, the manual route and the upgrade steps are in the
**[installation docs](docs/installation.md)**.

> **Do not upgrade through "uninstall → reinstall".** When this plugin is really uninstalled it cleans up
> the Python packages it registered (see the [uninstall docs](docs/uninstall.md)), so that route leaves you
> with an updated plugin and no Python environment. Instead: `pnpm update dsh-plugin-office-markdown`,
> use the Market's update button, or add the same address again in the install box.

## Usage

Nothing to memorise. Say "read and summarise this xlsx" — the skill registered by the plugin makes the
model convert first:

```
read_office_as_markdown({ path: "report.xlsx" })
```

The return value carries the path, size and line count of the resulting `.md`, plus a structure outline
(headings / sheets / slides with approximate line numbers), and hands back a reading strategy: read the
first 200 lines for structure, then grep within the same `.md`. **The artifact itself is never truncated** —
the model receives a complete Markdown file.

Other ways to call the tool: batch (`paths`, or point `path` at a directory), outline only
(`action: "outline"`, never triggers conversion), clean up stale artifacts of the same source
(`action: "clean"`, dry-run by default), inspect the current converter (`action: "status"`).
All parameters are in the **[usage docs](docs/usage.md)**.

## Converters

Probed in order, first available wins. This table mirrors `lib/convert.js`:

| # | Converter | Fidelity | Requires |
| --- | --- | --- | --- |
| 1 | `uvx markitdown` (temporary run) | high | `uv` + network (first run) |
| 2 | local `markitdown` command | high | markitdown installed |
| 3 | `python -m markitdown` | high | Python + markitdown |
| 4 | built-in Python fallback (`lib/fallback.py`) | limited | any Python 3; optional libs improve it |
| 5 | built-in Node fallback (`lib/fallback-node.js`) | limited | nothing |

**Level 5 needs neither Python nor network**: it parses OOXML directly with Node's built-in `zlib`
(`.docx` / `.xlsx` / `.pptx` are just zip + xml). It supports `.docx` `.docm` `.xlsx` `.xlsm` `.pptx` `.pptm`;
`.pdf` and legacy binary formats (`.doc` `.xls` `.ppt`) need MarkItDown or level 4.

Every artifact records who produced it on its first line; on a cache hit the plugin reads the **real**
converter and fidelity back from that line instead of claiming "high fidelity" unconditionally:

```
<!-- dsh-office-markdown converter=python-module fidelity=high at=<time> srcbytes=<bytes> srchash=<hash> -->
```

For maximum fidelity, open **Settings → Office conversion** and click "configure MarkItDown environment".
**The install script never installs any Python package on its own** — you pick the interpreter on that page.
Details are in the **[converter docs](docs/converters.md)**.

## Settings page

**Settings → Office conversion** shows the current converter, probes the local Python environments,
configures or uninstalls MarkItDown, displays the environment record the plugin adopted, and offers
"try converting one file" (which runs the real converter chain locally, bypassing the model and the cache).

The buttons call the plugin's own HTTP routes under `/office-markdown/api/*`; the route list is in the
[usage docs](docs/usage.md).

## Uninstall

Uninstall it from **Settings → Plugins**. The plugin first confirms it was **really removed**
(not disabled, not closed, not restarted), then dispatches a detached watchdog process that
`pip uninstall`s the packages it registered.

**Disabling, closing or restarting never triggers cleanup, and never leaves a resident process behind.**
Cleanup is strictly limited to the plugin's own environment record: packages shipped with the DSH runtime,
packages other components depend on, and anything you installed yourself are left untouched.
Details are in the **[uninstall docs](docs/uninstall.md)**.

## Requirements

- **Node ≥ 18**, built-in modules only (`fs` / `path` / `os` / `zlib` / `crypto` / `child_process` / `string_decoder`) —
  **0 npm dependencies**, no `npm install`.
- **Python and MarkItDown are entirely optional**; with neither, the level-5 Node fallback is used.
- Imports nothing from the host except `@deepseek-ai/dsh-tools` (for `defineTool`).
- DeepSeek Harness only. A profile without `webServer` (CLI profiles) simply has no settings page;
  the tool and the skill are unaffected.

## Documentation

The detailed docs are currently Chinese-only.

| Doc | Contents |
| --- | --- |
| [Installation](docs/installation.md) | four routes, manual install, upgrade, verification |
| [Usage](docs/usage.md) | tool parameters, skill, `read` guard, settings page, HTTP routes |
| [Converters](docs/converters.md) | converter chain, fidelity, multiple Python environments |
| [Configuration](docs/configuration.md) | config keys and defaults (mirrors `DEFAULTS` in `lib/index.js`) |
| [Artifacts & files](docs/artifacts.md) | where the `.md` goes, which files the plugin leaves behind |
| [Uninstall](docs/uninstall.md) | enable / disable / uninstall and cleanup scope |
| [Troubleshooting](docs/troubleshooting.md) | common symptoms |
| [Development](docs/development.md) | package layout, local development, releasing |
| [Changelog](CHANGELOG.md) | what changed in each version |

## About this documentation

The README, `docs/`, `CHANGELOG.md` and the release notes of this repository are **largely AI-generated**
(written by a coding agent running in DeepSeek Harness) and reviewed by the maintainer before publishing.

Config keys, HTTP routes, the converter chain and the file list were each **checked against the source**;
even so, the docs can lag behind the implementation or contain inaccuracies and omissions — **the code is
the reference**. Issues and corrections are welcome.

Numbers without a reproducible measurement behind them (for example "how many tokens does this save" or
"how much memory does it use") are deliberately **not** stated here.

## License

[MIT](LICENSE) © 2026 dsh-plugin-office-markdown contributors