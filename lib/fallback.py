#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-plugin-office-markdown — bundled fallback converter (limited fidelity).

Used ONLY when `uvx markitdown`, the `markitdown` CLI and `python -m markitdown`
are all unavailable. It extracts text and tables from the Office containers with
the libraries that ship inside the DSH Python runtime (python-docx, openpyxl,
python-pptx) and emits Markdown.

Fidelity is intentionally declared "limited": styling, charts, images, comments,
tracked changes, footnotes and scanned-PDF OCR are not recovered.

Usage:
    python fallback.py --input <source> --output <file.md>
                       [--max-rows N] [--max-cols N] [--max-cells N] [--max-slides N]

Exit codes: 0 ok, 2 unsupported format, 3 conversion error, 4 empty result.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import zlib

BANNER = (
    "<!-- 由 dsh-plugin-office-markdown 内置兜底转换器生成（非 MarkItDown），"
    "版式/图表/批注/图片等信息可能缺失，保真度有限。 -->\n"
)

UNSUPPORTED = {
    ".doc": "旧版 Word 97-2003（.doc）",
    ".xls": "旧版 Excel 97-2003（.xls）",
    ".ppt": "旧版 PowerPoint 97-2003（.ppt）",
    ".msg": "Outlook 邮件（.msg）",
    ".epub": "EPUB 电子书（.epub）",
    ".odt": "OpenDocument 文本（.odt）",
    ".ods": "OpenDocument 表格（.ods）",
    ".odp": "OpenDocument 演示（.odp）",
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def cell(value) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n").strip()
    text = text.replace("|", "\\|")
    if "\n" in text:
        text = text.replace("\n", "<br>")
    return text


def md_table(rows: list[list[str]], max_rows: int, max_cols: int, note: list[str], label: str) -> str:
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return ""
    truncated_cols = False
    if max_cols and any(len(r) > max_cols for r in rows):
        rows = [r[:max_cols] for r in rows]
        truncated_cols = True
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    truncated_rows = False
    if max_rows and len(rows) > max_rows:
        rows = rows[:max_rows]
        truncated_rows = True
    out = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
    for r in rows[1:]:
        out.append("| " + " | ".join(r) + " |")
    if truncated_rows or truncated_cols:
        bits = []
        if truncated_rows:
            bits.append("仅显示前 %d 行" % max_rows)
        if truncated_cols:
            bits.append("仅显示前 %d 列" % max_cols)
        note.append("%s：%s。" % (label, "、".join(bits)))
    return "\n".join(out)


# --------------------------------------------------------------------------
# docx
# --------------------------------------------------------------------------

_HEADING_RE = re.compile(r"(?:heading|标题)\s*(\d+)", re.I)


def convert_docx(src: str, opt) -> tuple[str, list[str]]:
    try:
        import docx  # python-docx
        from docx.table import Table
        from docx.text.paragraph import Paragraph
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("缺少 python-docx：%s" % exc)

    document = docx.Document(src)
    note: list[str] = []
    out: list[str] = []

    def emit_para(para) -> None:
        text = (para.text or "").strip()
        if not text:
            if out and out[-1] != "":
                out.append("")
            return
        style = ""
        try:
            style = (para.style.name or "")
        except Exception:
            style = ""
        low = style.strip().lower()
        m = _HEADING_RE.search(style)
        if m:
            level = max(1, min(int(m.group(1)), 6))
            out.append("#" * level + " " + text)
        elif low in ("title", "标题"):
            # python-docx 的 add_heading(text, 0) 用的是内建样式 "Title"，不含数字，
            # 匹配不到 _HEADING_RE，旧版会退化成普通段落。
            out.append("# " + text)
        elif low in ("subtitle", "副标题"):
            out.append("## " + text)
        elif low.startswith("list") or "列表" in style:
            out.append("- " + text)
        else:
            out.append(text)

    def emit_table(table, index: int) -> None:
        rows = []
        for row in table.rows:
            rows.append([cell(c.text) for c in row.cells])
        md = md_table(rows, opt.max_rows, opt.max_cols, note, "表格 %d" % index)
        if md:
            out.append("")
            out.append("**表格 %d**" % index)
            out.append("")
            out.append(md)

    # 按正文真实顺序遍历段落与表格，让表格留在它原本出现的位置，
    # 而不是像旧版那样把全部表格统一堆到文末。
    table_index = 0
    for child in document.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            emit_para(Paragraph(child, document))
        elif tag == "tbl":
            table_index += 1
            emit_table(Table(child, document), table_index)

    # 兜底：正文里什么都没取到（例如内容都在文本框内）时，
    # 退回 python-docx 的段落 / 表格列表接口。
    if not out:
        for para in document.paragraphs:
            emit_para(para)
        for index, table in enumerate(document.tables, start=1):
            emit_table(table, index)

    return "\n".join(out), note


# --------------------------------------------------------------------------
# xlsx
# --------------------------------------------------------------------------

def convert_xlsx(src: str, opt) -> tuple[str, list[str]]:
    try:
        import openpyxl
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("缺少 openpyxl：%s" % exc)

    workbook = openpyxl.load_workbook(src, read_only=True, data_only=True)
    note: list[str] = []
    out: list[str] = []
    cells = 0
    numeric_notes = ("openpyxl 以 data_only 读取：公式单元格只会显示上次由 Excel 保存的缓存值，"
                     "若线程中从未计算则显示为空。")

    for sheet in workbook.worksheets:
        out.append("## " + str(sheet.title))
        out.append("")
        rows: list[list[str]] = []
        stopped = False
        for raw in sheet.iter_rows(values_only=True):
            if raw is None:
                continue
            cells += len(raw)
            if opt.max_cells and cells > opt.max_cells:
                stopped = True
                break
            rows.append([cell(v) for v in raw])
        md = md_table(rows, opt.max_rows, opt.max_cols, note, "工作表「%s」" % sheet.title)
        if md:
            out.append(md)
        elif not rows:
            out.append("_(空工作表)_")
        if stopped:
            note.append("工作表「%s」：单元格总数超过上限 %d，已提前截断。" % (sheet.title, opt.max_cells))
        out.append("")

    try:
        workbook.close()
    except Exception:
        pass

    if any("#" in o for o in out):
        note.append(numeric_notes)
    return "\n".join(out), note


# --------------------------------------------------------------------------
# pptx
# --------------------------------------------------------------------------

def _shape_text(shape) -> list[str]:
    parts: list[str] = []
    if getattr(shape, "has_text_frame", False):
        for para in shape.text_frame.paragraphs:
            text = "".join(run.text or "" for run in para.runs).strip()
            if not text:
                text = (para.text or "").strip()
            if text:
                parts.append(text)
    if getattr(shape, "has_table", False):
        rows = []
        try:
            for row in shape.table.rows:
                rows.append([cell(c.text) for c in row.cells])
        except Exception:
            rows = []
        if rows:
            parts.append("")
            parts.append("| " + " | ".join(rows[0]) + " |")
            parts.append("| " + " | ".join(["---"] * len(rows[0])) + " |")
            for r in rows[1:]:
                parts.append("| " + " | ".join(r) + " |")
    return parts


def convert_pptx(src: str, opt) -> tuple[str, list[str]]:
    try:
        from pptx import Presentation
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("缺少 python-pptx：%s" % exc)

    presentation = Presentation(src)
    note: list[str] = []
    out: list[str] = []
    total = len(presentation.slides)

    for index, slide in enumerate(presentation.slides, start=1):
        if opt.max_slides and index > opt.max_slides:
            note.append("演示文稿共 %d 张幻灯片，仅转换前 %d 张。" % (total, opt.max_slides))
            break
        title_shape = None
        try:
            title_shape = slide.shapes.title
        except Exception:
            title_shape = None
        title = ""
        if title_shape is not None:
            try:
                title = (title_shape.text or "").strip()
            except Exception:
                title = ""
        out.append("## 幻灯片 %d%s" % (index, ("：" + title) if title else ""))
        out.append("")
        # python-pptx 每次访问 slide.shapes.title 都会重新包装同一段 XML，
        # 用 `shape is slide.shapes.title` 判定会永远为假，导致标题文本重复输出一次；
        # 改为按底层 lxml 元素判等。
        title_element = getattr(title_shape, "_element", None)
        for shape in slide.shapes:
            if title_element is not None and getattr(shape, "_element", None) is title_element:
                continue
            parts = _shape_text(shape)
            if parts:
                out.extend(parts)
                out.append("")
        if slide.has_notes_slide:
            try:
                notes = (slide.notes_slide.notes_text_frame.text or "").strip()
            except Exception:
                notes = ""
            if notes:
                out.append("> 备注：" + notes.replace("\n", " "))
                out.append("")

    return "\n".join(out), note


# --------------------------------------------------------------------------
# delimited / plain text
# --------------------------------------------------------------------------

def sniff_delimiter(sample: str, default: str = ",") -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except Exception:
        return default


def convert_delimited(src: str, opt, ext: str) -> tuple[str, list[str]]:
    default = "\t" if ext == ".tsv" else ","
    with open(src, "r", encoding="utf-8-sig", errors="replace", newline="") as handle:
        sample = handle.read(8192)
        handle.seek(0)
        delimiter = sniff_delimiter(sample, default)
        reader = csv.reader(handle, delimiter=delimiter)
        rows = [[cell(v) for v in row] for row in reader]
    note: list[str] = []
    md = md_table(rows, opt.max_rows, opt.max_cols, note, "分隔符文本")
    return md, note


def convert_text(src: str, opt) -> tuple[str, list[str]]:
    with open(src, "r", encoding="utf-8-sig", errors="replace") as handle:
        return handle.read(), []


def convert_json(src: str, opt) -> tuple[str, list[str]]:
    with open(src, "r", encoding="utf-8-sig", errors="replace") as handle:
        raw = handle.read()
    try:
        parsed = json.loads(raw)
        pretty = json.dumps(parsed, ensure_ascii=False, indent=2)
    except Exception:
        pretty = raw
    return "```json\n" + pretty + "\n```", []


# --------------------------------------------------------------------------
# html
# --------------------------------------------------------------------------

def convert_html(src: str, opt) -> tuple[str, list[str]]:
    from html.parser import HTMLParser

    class Extractor(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=True)
            self.parts: list[str] = []
            self.skip = 0

        def handle_starttag(self, tag, attrs):
            if tag in ("script", "style", "head"):
                self.skip += 1
            elif tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"):
                self.parts.append("\n")
                if tag.startswith("h") and len(tag) == 2 and tag[1].isdigit():
                    self.parts.append("#" * int(tag[1]) + " ")

        def handle_endtag(self, tag):
            if tag in ("script", "style", "head") and self.skip:
                self.skip -= 1

        def handle_data(self, data):
            if self.skip:
                return
            text = data.strip()
            if text:
                self.parts.append(text + " ")

    extractor = Extractor()
    with open(src, "r", encoding="utf-8-sig", errors="replace") as handle:
        extractor.feed(handle.read())
    text = re.sub(r"[ \t]+", " ", "".join(extractor.parts))
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip(), ["HTML 兜底提取仅保留可见文本，链接、图片与 CSS 布局丢失。"]


# --------------------------------------------------------------------------
# rtf
# --------------------------------------------------------------------------

def convert_rtf(src: str, opt) -> tuple[str, list[str]]:
    with open(src, "rb") as handle:
        data = handle.read().decode("latin-1", errors="replace")
    data = re.sub(r"\\'([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), data)
    data = re.sub(r"\\u(-?\d+)\?", lambda m: chr(int(m.group(1)) % 65536), data)
    data = re.sub(r"\\par[d]?", "\n", data)
    data = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", data)
    data = data.replace("{", "").replace("}", "")
    data = re.sub(r"\n{3,}", "\n\n", data)
    return data.strip(), ["RTF 兜底提取仅保留纯文本，格式、表格与图片丢失。"]


# --------------------------------------------------------------------------
# pdf
# --------------------------------------------------------------------------

_TOKEN_RE = re.compile(rb"\((?:[^()\\]|\\.)*\)|T\*|Td|TD|ET|Tj|TJ", re.S)
_OCTAL_RE = re.compile(rb"\\([0-7]{1,3})")


def _decode_pdf_string(raw: bytes) -> str:
    out = bytearray()
    i = 0
    n = len(raw)
    simple = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12,
              ord("("): 40, ord(")"): 41, ord("\\"): 92}
    while i < n:
        ch = raw[i]
        if ch == 0x5C and i + 1 < n:
            nxt = raw[i + 1]
            if nxt in simple:
                out.append(simple[nxt])
                i += 2
                continue
            m = _OCTAL_RE.match(raw, i)
            if m:
                out.append(int(m.group(1), 8) & 0xFF)
                i = m.end()
                continue
            i += 2
            continue
        out.append(ch)
        i += 1
    return out.decode("latin-1", errors="replace")


def _iter_pdf_streams(data: bytes):
    for match in re.finditer(rb"stream\r?\n", data):
        start = match.end()
        end = data.find(b"endstream", start)
        if end < 0:
            continue
        yield data[start:end].rstrip(b"\r\n")


def _inflate(raw: bytes):
    try:
        return zlib.decompress(raw)
    except Exception:
        pass
    try:
        return zlib.decompressobj().decompress(raw)
    except Exception:
        return None


def _content_stream_text(stream: bytes) -> str:
    lines: list[str] = []
    current: list[str] = []
    for match in _TOKEN_RE.finditer(stream):
        token = match.group(0)
        if token.startswith(b"("):
            current.append(_decode_pdf_string(token[1:-1]))
        elif token in (b"Td", b"TD", b"T*", b"ET"):
            if current:
                lines.append("".join(current))
                current = []
    if current:
        lines.append("".join(current))
    return "\n".join(lines)


def convert_pdf(src: str, opt) -> tuple[str, list[str]]:
    note: list[str] = []

    for module, label in (("pypdf", "pypdf"), ("PyPDF2", "PyPDF2"), ("pdfminer", "pdfminer.six")):
        try:
            if module == "pdfminer":
                from pdfminer.high_level import extract_text  # type: ignore
                text = extract_text(src)
            else:
                mod = __import__(module)
                reader = mod.PdfReader(src)
                pages = []
                for page in reader.pages:
                    pages.append(page.extract_text() or "")
                text = "\n\n".join(pages)
            note.append("PDF 文本由 %s 提取；图片、表格结构与扫描件内容未提取。" % label)
            return (text or "").strip(), note
        except ImportError:
            continue
        except Exception as exc:
            note.append("%s 提取 PDF 失败（%s），已改用内置极简提取。" % (label, exc))
            break

    with open(src, "rb") as handle:
        data = handle.read()
    chunks = []
    for raw in _iter_pdf_streams(data):
        stream = _inflate(raw)
        if not stream:
            continue
        if b"Tj" not in stream and b"TJ" not in stream:
            continue
        text = _content_stream_text(stream)
        if text.strip():
            chunks.append(text)
    note.append(
        "内置极简 PDF 提取：只能识别简单 Latin 编码文本流，"
        "中文/CID 字体、表格、图片与扫描件通常无法提取。安装 MarkItDown 可获得完整保真度。"
    )
    return "\n\n".join(chunks).strip(), note


# --------------------------------------------------------------------------
# dispatch
# --------------------------------------------------------------------------

CONVERTERS = {
    ".docx": convert_docx,
    ".docm": convert_docx,
    ".xlsx": convert_xlsx,
    ".xlsm": convert_xlsx,
    ".pptx": convert_pptx,
    ".pptm": convert_pptx,
    ".pdf": convert_pdf,
    ".csv": convert_delimited,
    ".tsv": convert_delimited,
    ".txt": convert_text,
    ".md": convert_text,
    ".html": convert_html,
    ".htm": convert_html,
    ".rtf": convert_rtf,
    ".json": convert_json,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="dsh-plugin-office-markdown fallback converter")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-rows", type=int, default=400)
    parser.add_argument("--max-cols", type=int, default=24)
    parser.add_argument("--max-cells", type=int, default=20000)
    parser.add_argument("--max-slides", type=int, default=0)
    opt = parser.parse_args()

    src = os.path.abspath(opt.input)
    if not os.path.isfile(src):
        print("[fallback] 输入文件不存在：%s" % src, file=sys.stderr)
        return 3

    ext = os.path.splitext(src)[1].lower()
    if ext in UNSUPPORTED:
        print(
            "[fallback] 不支持 %s；请安装 MarkItDown（uvx markitdown / pip install \"markitdown[all]\"）后重试。"
            % UNSUPPORTED[ext],
            file=sys.stderr,
        )
        return 2

    converter = CONVERTERS.get(ext)
    if converter is None:
        print("[fallback] 未知文件类型 %s，内置兜底转换器无法处理。" % (ext or "(无扩展名)"), file=sys.stderr)
        return 2

    try:
        body, note = converter(src, opt)
    except Exception as exc:  # noqa: BLE001
        print("[fallback] 转换失败：%s: %s" % (type(exc).__name__, exc), file=sys.stderr)
        return 3

    body = (body or "").strip()
    if not body:
        print("[fallback] 未能提取到任何文本（可能是扫描件、纯图片或特殊编码）。", file=sys.stderr)
        return 4

    header = BANNER + "> 源文件：`%s`\n> 转换器：内置兜底（fallback.py）\n\n" % os.path.basename(src)
    footer = ""
    if note:
        footer = "\n\n---\n\n**转换提示**\n\n" + "\n".join("- " + n for n in note) + "\n"

    with open(opt.output, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(header + body + footer)
    return 0


if __name__ == "__main__":
    sys.exit(main())