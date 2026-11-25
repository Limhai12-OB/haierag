"""Parser abstraction: each format turns bytes into ordered, located text segments."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Protocol

from app.core.errors import UnsupportedDocumentError


@dataclass
class Segment:
    """A contiguous piece of extracted content with its source location.

    kind: "heading" (starts a new section), "text" (prose), or "table" (markdown table; header in metadata).
    """

    text: str
    kind: str = "text"
    page: int | None = None          # 1-based page / slide number when the format has pages
    heading: str | None = None       # nearest section heading (for heading segments: the heading itself)
    level: int | None = None         # heading level when known
    metadata: dict = field(default_factory=dict)


@dataclass
class ParsedDocument:
    segments: list[Segment]
    page_count: int | None = None
    metadata: dict = field(default_factory=dict)


class DocumentParser(Protocol):
    def parse(self, data: bytes, filename: str) -> ParsedDocument: ...


_REGISTRY: dict[str, Callable[[], DocumentParser]] = {}


def register(file_type: str):
    def deco(factory: Callable[[], DocumentParser]):
        _REGISTRY[file_type.upper()] = factory
        return factory

    return deco


def get_parser(file_type: str) -> DocumentParser:
    from app.parsing import formats  # noqa: F401  (registers parsers)

    factory = _REGISTRY.get(file_type.upper())
    if factory is None:
        raise UnsupportedDocumentError(f"No parser for file type {file_type}")
    return factory()


def rows_to_markdown(rows: list[list[str]]) -> str:
    """Render rows (first row = header) as a GitHub-flavoured markdown table."""
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    norm = [[(c or "").replace("|", "\\|").replace("\n", " ").strip() for c in r] + [""] * (width - len(r)) for r in rows]
    header, body = norm[0], norm[1:]
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in body]
    return "\n".join(lines)
