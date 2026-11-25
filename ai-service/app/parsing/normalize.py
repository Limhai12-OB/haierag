"""Text normalisation that cleans extraction noise without destroying structure.

Keeps: paragraph breaks, line breaks inside tables/lists, Khmer combining marks (NFC only, never NFKD).
Removes: control characters, soft hyphens, BOMs, runs of spaces, 3+ blank lines, PDF hyphenation at line ends.
"""

from __future__ import annotations

import re
import unicodedata

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f­﻿]")
_SPACES = re.compile(r"[ \t  -   　]+")
_MANY_NEWLINES = re.compile(r"\n{3,}")
_HYPHEN_BREAK = re.compile(r"(?<=[A-Za-z])-\n(?=[a-z])")
_KHMER = re.compile(r"[ក-៿᧠-᧿]")


def normalize_text(text: str, dehyphenate: bool = False) -> str:
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", text)
    if dehyphenate:
        text = _HYPHEN_BREAK.sub("", text)
    lines = [_SPACES.sub(" ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = _MANY_NEWLINES.sub("\n\n", text)
    return text.strip()


def contains_khmer(text: str) -> bool:
    return bool(_KHMER.search(text))
