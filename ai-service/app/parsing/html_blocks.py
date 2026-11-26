"""Structure-preserving full-page text extraction for web pages (fallback for ADR-018).

Article extractors (trafilatura) pick one "main content" block. That suits news and wiki articles but loses most
of single-page sites (portfolios, landing pages, product pages) where content is spread over many sections. This
walker keeps all visible text in document order, as markdown: headings stay headings, list items become "- ",
tables become markdown tables, block elements become line breaks. Scripts, styles, navigation menus, forms and
hidden elements are dropped.
"""

from __future__ import annotations

import re

from lxml import html as lxml_html

from app.parsing.base import rows_to_markdown

_DROP = {"script", "style", "noscript", "template", "svg", "nav", "form", "button", "select", "input", "textarea",
         "iframe", "canvas", "video", "audio", "picture", "img", "head", "title", "meta", "link"}
_HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
_PARAGRAPH = {"p", "section", "article", "main", "header", "footer", "aside", "blockquote", "ul", "ol", "dl",
              "figure", "details", "address", "hr"}
_LINE = {"div", "li", "dt", "dd", "tr", "br", "summary", "figcaption", "caption"}
_WS = re.compile(r"[ \t ​]+")


def _hidden(el) -> bool:
    if el.get("hidden") is not None or el.get("aria-hidden") == "true":
        return True
    style = (el.get("style") or "").replace(" ", "").lower()
    return "display:none" in style or "visibility:hidden" in style


def _text(el) -> str:
    return _WS.sub(" ", el.text_content()).strip()


def _table(el) -> str:
    rows = []
    for tr in el.iter("tr"):
        cells = [_text(c) for c in tr if isinstance(c.tag, str) and c.tag.lower() in ("td", "th")]
        if any(cells):
            rows.append(cells)
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    return rows_to_markdown([r + [""] * (width - len(r)) for r in rows])


def _walk(el, out: list[str]) -> None:
    tag = el.tag.lower() if isinstance(el.tag, str) else None
    if tag is not None and tag not in _DROP and not _hidden(el):
        if tag in _HEADINGS:
            text = _text(el)
            if text:
                out.append(f"\n\n{'#' * _HEADINGS[tag]} {text}\n\n")
        elif tag == "table":
            out.append(f"\n\n{_table(el)}\n\n")
        elif tag == "pre":
            out.append(f"\n\n{el.text_content().strip()}\n\n")
        else:
            sep = "\n\n" if tag in _PARAGRAPH else "\n" if tag in _LINE else ""
            out.append(sep)
            if tag == "li":
                out.append("- ")
            if el.text:
                out.append(el.text)
            for child in el:
                _walk(child, out)
            out.append(sep)
    if el.tail:
        out.append(el.tail)


def page_markdown(data: bytes) -> str:
    """All visible text of an HTML page as markdown (empty string if the page cannot be parsed)."""
    try:
        doc = lxml_html.document_fromstring(data)
    except (ValueError, lxml_html.etree.ParserError):
        return ""
    body = doc.find("body")
    out: list[str] = []
    _walk(body if body is not None else doc, out)
    lines = [_WS.sub(" ", line).strip() for line in "".join(out).split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    text = re.sub(r"^- *$\n?", "", text, flags=re.MULTILINE)  # list markers without text (icon-only items)
    # keep consecutive list items together (no blank line between "- a" and "- b")
    out_lines: list[str] = []
    rows = text.split("\n")
    for i, line in enumerate(rows):
        if line == "" and out_lines and out_lines[-1].startswith("- ") and i + 1 < len(rows) and rows[i + 1].startswith("- "):
            continue
        out_lines.append(line)
    return "\n".join(out_lines)


def visible_text_length(markdown: str) -> int:
    return len(re.sub(r"[#|\-\s]", "", markdown))
