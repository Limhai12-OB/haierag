"""Concrete parsers for PDF, DOCX, XLSX, PPTX, TXT, Markdown and CSV."""

from __future__ import annotations

import csv
import io
import re
import statistics
import zipfile

from app.core.errors import DocumentParseError
from app.parsing.base import ParsedDocument, Segment, register, rows_to_markdown
from app.parsing.normalize import normalize_text

TABLE_ROWS_PER_SEGMENT = 40


def _decode_text(data: bytes) -> str:
    if b"\x00" in data[:8192]:
        raise DocumentParseError("File contains binary data, not text")
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise DocumentParseError("Text file is not valid UTF-8")


def _table_segments(rows: list[list[str]], page: int | None, label: str | None) -> list[Segment]:
    """Split a large table into row blocks, repeating the header so each block is self-describing."""
    rows = [r for r in rows if any((c or "").strip() for c in r)]
    if not rows:
        return []
    header, body = rows[0], rows[1:]
    if not body:
        return [Segment(rows_to_markdown([header]), kind="table", page=page, metadata={"table": label})]
    out = []
    for i in range(0, len(body), TABLE_ROWS_PER_SEGMENT):
        block = body[i : i + TABLE_ROWS_PER_SEGMENT]
        out.append(
            Segment(
                rows_to_markdown([header, *block]),
                kind="table",
                page=page,
                metadata={"table": label, "header": rows_to_markdown([header]), "row_start": i + 1},
            )
        )
    return out


# ---------------------------------------------------------------------------------------------------------- PDF
@register("PDF")
class PdfParser:
    """PyMuPDF: per-page text blocks in reading order, font-size based heading detection, table extraction."""

    def parse(self, data: bytes, filename: str) -> ParsedDocument:
        import pymupdf

        try:
            doc = pymupdf.open(stream=data, filetype="pdf")
        except Exception as exc:
            raise DocumentParseError(f"Could not open PDF: {exc}") from exc
        if doc.needs_pass:
            raise DocumentParseError("PDF is password protected")
        try:
            return self._parse(doc)
        finally:
            doc.close()

    def _parse(self, doc) -> ParsedDocument:
        pages = []
        sizes: list[float] = []
        for page in doc:
            d = page.get_text("dict", sort=True)
            pages.append((page, d))
            for b in d["blocks"]:
                for line in b.get("lines", []):
                    for span in line["spans"]:
                        if span["text"].strip():
                            sizes.extend([round(span["size"], 1)] * len(span["text"]))
        body_size = statistics.median(sizes) if sizes else 10.0

        segments: list[Segment] = []
        empty_pages = []
        for page, d in pages:
            pno = page.number + 1
            tables = []
            try:
                tables = list(page.find_tables().tables)
            except Exception:
                tables = []
            table_rects = [t.bbox for t in tables]
            page_has_text = False

            for b in d["blocks"]:
                if b.get("type") != 0:
                    continue
                x0, y0, x1, y1 = b["bbox"]
                if any(x0 >= tx0 - 2 and y0 >= ty0 - 2 and x1 <= tx1 + 2 and y1 <= ty1 + 2 for tx0, ty0, tx1, ty1 in table_rects):
                    continue
                lines_text = []
                max_size, bold = 0.0, True
                for line in b.get("lines", []):
                    t = "".join(s["text"] for s in line["spans"])
                    if t.strip():
                        lines_text.append(t)
                        for s in line["spans"]:
                            if s["text"].strip():
                                max_size = max(max_size, s["size"])
                                bold = bold and bool(s["flags"] & 16)
                text = normalize_text("\n".join(lines_text), dehyphenate=True)
                if not text:
                    continue
                page_has_text = True
                is_heading = (
                    len(text) <= 150
                    and "\n" not in text.strip()
                    and not text.rstrip().endswith((".", ",", ";"))
                    and (max_size >= body_size * 1.18 or (bold and max_size >= body_size and len(text) <= 80))
                )
                if is_heading:
                    level = 1 if max_size >= body_size * 1.6 else 2 if max_size >= body_size * 1.3 else 3
                    segments.append(Segment(text, kind="heading", page=pno, heading=text, level=level))
                else:
                    # PDF lines are layout lines, not paragraphs: join them into flowing text.
                    segments.append(Segment(re.sub(r"(?<!\n)\n(?!\n)", " ", text), kind="text", page=pno))

            for idx, t in enumerate(tables):
                try:
                    rows = [[c if c is not None else "" for c in row] for row in t.extract()]
                except Exception:
                    continue
                segs = _table_segments([[normalize_text(c) for c in r] for r in rows], pno, f"page {pno} table {idx + 1}")
                if segs:
                    page_has_text = True
                    # place tables by vertical position relative to text: append (good enough for retrieval)
                    segments.extend(segs)
            if not page_has_text:
                empty_pages.append(pno)

        if not segments:
            raise DocumentParseError(
                "No extractable text found in the PDF. It may be a scanned/image-only PDF (OCR is not supported yet)."
            )
        return ParsedDocument(
            segments=segments,
            page_count=len(pages),
            metadata={"pages_without_text": empty_pages, "body_font_size": body_size},
        )


# --------------------------------------------------------------------------------------------------------- DOCX
@register("DOCX")
class DocxParser:
    def parse(self, data: bytes, filename: str) -> ParsedDocument:
        import docx
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        try:
            document = docx.Document(io.BytesIO(data))
        except Exception as exc:
            raise DocumentParseError(f"Could not open DOCX: {exc}") from exc

        segments: list[Segment] = []
        for block in document.element.body.iterchildren():
            tag = block.tag.rsplit("}", 1)[-1]
            if tag == "p":
                p = Paragraph(block, document)
                text = normalize_text(p.text)
                if not text:
                    continue
                style = (p.style.name if p.style is not None else "") or ""
                m = re.match(r"(?i)heading\s*(\d)", style)
                if m or style.lower() == "title":
                    level = int(m.group(1)) if m else 1
                    segments.append(Segment(text, kind="heading", heading=text, level=level))
                elif style.lower().startswith("list"):
                    segments.append(Segment(f"- {text}", kind="text", metadata={"list": True}))
                else:
                    segments.append(Segment(text, kind="text"))
            elif tag == "tbl":
                table = Table(block, document)
                rows = []
                for row in table.rows:
                    cells, prev = [], None
                    for cell in row.cells:  # merged cells repeat the same object
                        if cell._tc is prev:
                            continue
                        prev = cell._tc
                        cells.append(normalize_text(cell.text))
                    rows.append(cells)
                segments.extend(_table_segments(rows, None, f"table {sum(1 for s in segments if s.kind == 'table') + 1}"))
        if not segments:
            raise DocumentParseError("The DOCX document contains no text")
        return ParsedDocument(segments=segments)


# --------------------------------------------------------------------------------------------------------- XLSX
@register("XLSX")
class XlsxParser:
    def parse(self, data: bytes, filename: str) -> ParsedDocument:
        import openpyxl

        try:
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except (zipfile.BadZipFile, Exception) as exc:
            raise DocumentParseError(f"Could not open XLSX: {exc}") from exc
        segments: list[Segment] = []
        try:
            for idx, ws in enumerate(wb.worksheets, start=1):
                rows = []
                for row in ws.iter_rows(values_only=True):
                    cells = ["" if v is None else normalize_text(str(v)) for v in row]
                    while cells and not cells[-1]:
                        cells.pop()
                    rows.append(cells)
                rows = [r for r in rows if any(r)]
                if not rows:
                    continue
                heading = f"Sheet: {ws.title}"
                segments.append(Segment(heading, kind="heading", heading=heading, level=1, page=idx))
                for seg in _table_segments(rows, idx, ws.title):
                    segments.append(seg)
        finally:
            wb.close()
        if not segments:
            raise DocumentParseError("The workbook contains no data")
        return ParsedDocument(segments=segments, page_count=len(wb.worksheets), metadata={"page_unit": "sheet"})


# --------------------------------------------------------------------------------------------------------- PPTX
@register("PPTX")
class PptxParser:
    def parse(self, data: bytes, filename: str) -> ParsedDocument:
        from pptx import Presentation

        try:
            prs = Presentation(io.BytesIO(data))
        except Exception as exc:
            raise DocumentParseError(f"Could not open PPTX: {exc}") from exc
        segments: list[Segment] = []
        for sno, slide in enumerate(prs.slides, start=1):
            title_shape = slide.shapes.title
            title = normalize_text(title_shape.text_frame.text) if title_shape is not None and title_shape.has_text_frame else ""
            heading = title or f"Slide {sno}"
            segments.append(Segment(heading, kind="heading", heading=heading, level=2, page=sno))
            for shape in slide.shapes:
                if title_shape is not None and shape.shape_id == title_shape.shape_id:
                    continue
                if shape.has_text_frame:
                    text = normalize_text("\n".join(p.text for p in shape.text_frame.paragraphs))
                    if text:
                        segments.append(Segment(text, kind="text", page=sno))
                if getattr(shape, "has_table", False) and shape.has_table:
                    rows = [[normalize_text(c.text) for c in r.cells] for r in shape.table.rows]
                    segments.extend(_table_segments(rows, sno, f"slide {sno} table"))
            if slide.has_notes_slide:
                notes = normalize_text(slide.notes_slide.notes_text_frame.text)
                if notes:
                    segments.append(Segment(f"Speaker notes: {notes}", kind="text", page=sno, metadata={"notes": True}))
        if not any(s.kind != "heading" or not s.text.startswith("Slide ") for s in segments):
            raise DocumentParseError("The presentation contains no text")
        return ParsedDocument(segments=segments, page_count=len(prs.slides), metadata={"page_unit": "slide"})


# --------------------------------------------------------------------------------------------------- TXT / MD
def _paragraph_segments(text: str) -> list[Segment]:
    return [Segment(p.strip(), kind="text") for p in re.split(r"\n\s*\n", text) if p.strip()]


@register("TXT")
class TextParser:
    def parse(self, data: bytes, filename: str) -> ParsedDocument:
        text = normalize_text(_decode_text(data))
        if not text:
            raise DocumentParseError("The text file is empty")
        return ParsedDocument(segments=_paragraph_segments(text))


_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


@register("MARKDOWN")
class MarkdownParser:
    def parse(self, data: bytes, filename: str) -> ParsedDocument:
        text = normalize_text(_decode_text(data))
        if not text:
            raise DocumentParseError("The markdown file is empty")
        segments: list[Segment] = []
        buf: list[str] = []
        in_fence = False

        def flush():
            if buf:
                segments.extend(_paragraph_segments("\n".join(buf)))
                buf.clear()

        for line in text.split("\n"):
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
                buf.append(line)
                continue
            m = None if in_fence else _MD_HEADING.match(line)
            if m:
                flush()
                h = m.group(2).strip()
                segments.append(Segment(h, kind="heading", heading=h, level=len(m.group(1))))
            else:
                buf.append(line)
        flush()
        return ParsedDocument(segments=segments)


# ---------------------------------------------------------------------------------------------------------- CSV
@register("CSV")
class CsvParser:
    def parse(self, data: bytes, filename: str) -> ParsedDocument:
        text = _decode_text(data)
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        rows = [[normalize_text(c) for c in r] for r in csv.reader(io.StringIO(text), dialect)]
        segments = _table_segments(rows, None, filename)
        if not segments:
            raise DocumentParseError("The CSV file is empty")
        return ParsedDocument(segments=segments, metadata={"rows": max(0, len(rows) - 1)})
