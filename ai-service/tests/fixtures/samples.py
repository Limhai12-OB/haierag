"""Deterministic sample documents with known facts, used by tests and the end-to-end verification."""

from __future__ import annotations

import io

# Known facts (question → expected key phrase, page) used for answer checks.
HANDBOOK_FACTS = [
    ("How many days of annual leave do full-time employees get?", "21", 2),
    ("What is the maximum hotel rate per night for business travel in Phnom Penh?", "120", 3),
    ("Which VPN client must employees use for remote access?", "WireGuard", 4),
    ("Within how many hours must a security incident be reported?", "4", 4),
]

HANDBOOK_PAGES: list[tuple[str, list[str]]] = [
    (
        "Northwind Robotics Employee Handbook",
        [
            "This handbook describes the policies that apply to all employees of Northwind Robotics Co., Ltd., "
            "a company headquartered in Phnom Penh, Cambodia. It was approved by the board on 3 March 2025.",
            "The handbook covers working hours, leave, travel, information security and conduct. Where local labour "
            "law provides more favourable terms, the law prevails.",
        ],
    ),
    (
        "Leave Policy",
        [
            "Full-time employees receive 21 days of paid annual leave per calendar year. Leave accrues monthly at a "
            "rate of 1.75 days. Up to 5 unused days may be carried over to the next year and must be used by 31 March.",
            "Sick leave of up to 10 days per year is paid at full salary when supported by a medical certificate. "
            "Parental leave is 90 calendar days for the primary caregiver and 14 days for the secondary caregiver.",
        ],
    ),
    (
        "Travel and Expenses",
        [
            "Employees travelling on company business must book through the approved travel portal. Economy class "
            "is required for flights shorter than six hours.",
            "TABLE",
            "Receipts must be submitted within 30 days of returning from a trip. Late submissions require approval "
            "from the department head.",
        ],
    ),
    (
        "Information Security",
        [
            "All remote access to company systems must use the WireGuard VPN client issued by the IT department. "
            "Personal VPN services are not permitted on company devices.",
            "Passwords must be at least 14 characters long and must not be reused across systems. Multi-factor "
            "authentication is mandatory for email, source code repositories and the HR portal.",
            "Any suspected security incident, including a lost laptop or phishing email, must be reported to the "
            "security team within 4 hours of discovery by emailing security@northwind.example.",
        ],
    ),
]

TRAVEL_TABLE = [
    ["City", "Hotel limit per night (USD)", "Daily meal allowance (USD)"],
    ["Phnom Penh", "120", "35"],
    ["Siem Reap", "90", "30"],
    ["Bangkok", "150", "45"],
    ["Singapore", "260", "70"],
]


def make_handbook_pdf() -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="Northwind Robotics Employee Handbook")
    story = []
    for i, (heading, paras) in enumerate(HANDBOOK_PAGES):
        story.append(Paragraph(heading, styles["Title" if i == 0 else "Heading1"]))
        story.append(Spacer(1, 8))
        for p in paras:
            if p == "TABLE":
                t = Table(TRAVEL_TABLE)
                t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black)]))
                story.append(t)
            else:
                story.append(Paragraph(p, styles["BodyText"]))
            story.append(Spacer(1, 6))
        if i < len(HANDBOOK_PAGES) - 1:
            story.append(PageBreak())
    doc.build(story)
    return buf.getvalue()


def make_docx(paragraphs: list[tuple[str, str]], table: list[list[str]] | None = None) -> bytes:
    """paragraphs: (style, text) where style is 'h1', 'h2' or 'p'."""
    import docx

    d = docx.Document()
    for style, text in paragraphs:
        if style == "h1":
            d.add_heading(text, level=1)
        elif style == "h2":
            d.add_heading(text, level=2)
        else:
            d.add_paragraph(text)
    if table:
        t = d.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, val in enumerate(row):
                t.cell(r, c).text = val
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def make_xlsx(sheets: dict[str, list[list]]) -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def make_pptx(slides: list[tuple[str, str]]) -> bytes:
    from pptx import Presentation

    prs = Presentation()
    for title, body in slides:
        s = prs.slides.add_slide(prs.slide_layouts[1])
        s.shapes.title.text = title
        s.placeholders[1].text = body
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


KHMER_DOC = """# គោលនយោបាយការងារ

## ការឈប់សម្រាក

បុគ្គលិកពេញម៉ោងទទួលបានការឈប់សម្រាកប្រចាំឆ្នាំចំនួន ២១ ថ្ងៃ ដោយមានប្រាក់ឈ្នួល។ ការឈប់សម្រាកឈឺអាចមានរហូតដល់ ១០ ថ្ងៃក្នុងមួយឆ្នាំ។

## សុវត្ថិភាពព័ត៌មាន

រាល់ឧប្បត្តិហេតុសុវត្ថិភាពត្រូវរាយការណ៍ទៅក្រុមសុវត្ថិភាពក្នុងរយៈពេល ៤ ម៉ោង។ ពាក្យសម្ងាត់ត្រូវមានយ៉ាងហោចណាស់ ១៤ តួអក្សរ។
"""
