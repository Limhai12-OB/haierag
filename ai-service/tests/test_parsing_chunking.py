"""Parser and chunker tests on generated documents of every supported format."""

from __future__ import annotations

import pytest

from app.chunking.structured import ChunkingConfig, StructuredChunker, split_sentences
from app.core.errors import DocumentParseError, UnsupportedDocumentError
from app.parsing.base import Segment, get_parser
from app.parsing.normalize import normalize_text
from tests.fixtures import samples


# --------------------------------------------------------------------------------------------- parsers
def test_pdf_pages_headings_and_table():
    parsed = get_parser("PDF").parse(samples.make_handbook_pdf(), "handbook.pdf")
    assert parsed.page_count == 4
    headings = [(s.text, s.page) for s in parsed.segments if s.kind == "heading"]
    assert ("Leave Policy", 2) in headings and ("Information Security", 4) in headings
    leave = next(s for s in parsed.segments if "21 days of paid annual leave" in s.text)
    assert leave.page == 2
    tables = [s for s in parsed.segments if s.kind == "table"]
    assert tables and tables[0].page == 3 and "Phnom Penh" in tables[0].text and "| 120 |" in tables[0].text
    # table text must not be duplicated as prose
    assert not any("Siem Reap" in s.text for s in parsed.segments if s.kind == "text")


def test_pdf_corrupted_and_empty():
    with pytest.raises(DocumentParseError):
        get_parser("PDF").parse(b"%PDF-1.4 garbage", "x.pdf")
    import pymupdf

    doc = pymupdf.open()
    doc.new_page()
    with pytest.raises(DocumentParseError, match="scanned"):
        get_parser("PDF").parse(doc.tobytes(), "blank.pdf")


def test_docx_headings_paragraphs_tables():
    data = samples.make_docx(
        [("h1", "Security"), ("p", "Use the WireGuard VPN."), ("h2", "Passwords"), ("p", "At least 14 characters.")],
        table=[["Role", "Access"], ["Admin", "Full"]],
    )
    segs = get_parser("DOCX").parse(data, "a.docx").segments
    assert [s.text for s in segs if s.kind == "heading"] == ["Security", "Passwords"]
    assert any(s.kind == "table" and "| Admin | Full |" in s.text for s in segs)


def test_xlsx_sheets_as_tables():
    data = samples.make_xlsx({"Prices": [["Item", "USD"], ["Robot arm", 1200], ["Sensor", 35.5]], "Empty": []})
    parsed = get_parser("XLSX").parse(data, "p.xlsx")
    assert parsed.segments[0].text == "Sheet: Prices"
    assert "| Robot arm | 1200 |" in parsed.segments[1].text


def test_pptx_slides_as_pages():
    data = samples.make_pptx([("Roadmap", "Launch in Q3"), ("Budget", "USD 2 million")])
    parsed = get_parser("PPTX").parse(data, "d.pptx")
    assert parsed.page_count == 2
    body = [s for s in parsed.segments if s.kind == "text"]
    assert body[1].text == "USD 2 million" and body[1].page == 2


def test_markdown_txt_csv():
    md = get_parser("MARKDOWN").parse(samples.KHMER_DOC.encode(), "k.md").segments
    assert [s.text for s in md if s.kind == "heading"] == ["គោលនយោបាយការងារ", "ការឈប់សម្រាក", "សុវត្ថិភាពព័ត៌មាន"]
    txt = get_parser("TXT").parse("Para one.\n\nPara two.".encode(), "t.txt").segments
    assert [s.text for s in txt] == ["Para one.", "Para two."]
    csv_segs = get_parser("CSV").parse(b"name;age\nAlice;30\nBob;41\n", "c.csv").segments
    assert "| Alice | 30 |" in csv_segs[0].text


def test_text_rejects_binary_and_unknown_type():
    with pytest.raises(DocumentParseError):
        get_parser("TXT").parse(b"\x00\x01\x02binary", "b.txt")
    with pytest.raises(DocumentParseError):
        get_parser("TXT").parse(b"   \n ", "e.txt")
    with pytest.raises(UnsupportedDocumentError):
        get_parser("EXE")


def test_normalize_keeps_khmer_and_structure():
    raw = "Hello  world\x07\r\n\r\n\r\n\r\nNext   para­\nគោល​នយោបាយ"
    out = normalize_text(raw)
    assert out == "Hello world\n\nNext para\nគោល​នយោបាយ"
    assert normalize_text("infor-\nmation", dehyphenate=True) == "information"


# --------------------------------------------------------------------------------------------- chunker
def _chunker(counter, size=120, overlap=20, min_tokens=10):
    return StructuredChunker(counter, ChunkingConfig(size, overlap, min_tokens))


def test_sentence_split_khmer_and_latin():
    assert split_sentences("One. Two! ប្រយោគ១។ប្រយោគ២។") == ["One.", "Two!", "ប្រយោគ១។", "ប្រយោគ២។"]


def test_chunks_respect_size_and_keep_metadata(token_counter):
    segs = [Segment("Intro", kind="heading", heading="Intro", page=1)]
    segs += [Segment(f"Sentence number {i} talks about robots and policies in some detail.", page=1 + i // 10) for i in range(40)]
    chunks = _chunker(token_counter).chunk(segs)
    assert len(chunks) > 3
    for c in chunks:
        assert c.token_count <= 120
        assert c.section_heading == "Intro"
        assert c.page_start is not None and c.page_start <= c.page_end
    assert chunks[0].content.startswith("Intro")
    assert [c.index for c in chunks] == list(range(len(chunks)))


def test_overlap_repeats_trailing_sentences(token_counter):
    para = " ".join(f"Fact {i} is important." for i in range(60))
    chunks = _chunker(token_counter, size=100, overlap=25).chunk([Segment(para, page=1)])
    assert len(chunks) >= 3
    for a, b in zip(chunks, chunks[1:]):
        first_sentence_b = b.content.split(". ")[0] + "."
        assert first_sentence_b in a.content, "next chunk should start with a sentence from the previous one"
        assert token_counter.count(first_sentence_b) <= 25


def test_headings_start_new_chunks(token_counter):
    long = " ".join(["Leave accrues monthly for every employee."] * 6)
    segs = [
        Segment("Leave", kind="heading", heading="Leave"), Segment(long),
        Segment("Security", kind="heading", heading="Security"), Segment("Use WireGuard VPN. " * 5),
    ]
    chunks = _chunker(token_counter, size=400).chunk(segs)
    assert [c.section_heading for c in chunks] == ["Leave", "Security"]
    assert chunks[1].content.startswith("Security")


def test_tiny_sections_merge(token_counter):
    segs = []
    for i in range(5):
        segs += [Segment(f"H{i}", kind="heading", heading=f"H{i}"), Segment(f"Short {i}.")]
    chunks = _chunker(token_counter, size=200, min_tokens=50).chunk(segs)
    assert len(chunks) == 1 and chunks[0].metadata["headings"] == [f"H{i}" for i in range(5)]


def test_long_unspaced_khmer_is_hard_split(token_counter):
    text = "ការអប់រំ" * 400  # no spaces, no sentence marks
    chunks = _chunker(token_counter, size=100, overlap=0).chunk([Segment(text)])
    assert len(chunks) > 1 and all(c.token_count <= 100 for c in chunks)
    assert "".join(c.content for c in chunks) == text


def test_big_table_split_repeats_header(token_counter):
    rows = [["Name", "Value"]] + [[f"item{i}", str(i)] for i in range(200)]
    from app.parsing.base import rows_to_markdown

    chunks = _chunker(token_counter, size=150, overlap=0).chunk([Segment(rows_to_markdown(rows), kind="table")])
    assert len(chunks) > 1
    assert all(c.content.startswith("| Name | Value |") for c in chunks)


def test_config_validation():
    with pytest.raises(ValueError):
        ChunkingConfig(chunk_size=100, overlap=60)
