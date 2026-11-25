"""Benchmark corpus v1: English, Khmer, mixed Khmer-English, tables, a long document, near-duplicate terminology,
and questions whose answers are absent. Relevance = chunks of `doc` that contain `phrase`.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BenchDoc:
    name: str
    file_type: str
    text: str | None = None          # for text formats
    builder: str | None = None       # name of a sample builder (binary formats)
    tags: list[str] = field(default_factory=list)


@dataclass
class BenchQuestion:
    id: str
    question: str
    lang: str                         # en | km | mixed
    category: str                     # fact | table | long | similar | absent
    doc: str | None = None            # expected document (None = absent from KB)
    phrase: str | None = None         # phrase the relevant chunk must contain / the answer should contain


KM_POLICY = """# គោលនយោបាយធនធានមនុស្ស

## ការឈប់សម្រាកប្រចាំឆ្នាំ

បុគ្គលិកពេញម៉ោងទទួលបានការឈប់សម្រាកប្រចាំឆ្នាំចំនួន ២១ ថ្ងៃ ដោយមានប្រាក់ឈ្នួល។ ថ្ងៃឈប់សម្រាកដែលមិនបានប្រើអាចផ្ទេរទៅឆ្នាំបន្ទាប់បានរហូតដល់ ៥ ថ្ងៃ។

## ការឈប់សម្រាកឈឺ

បុគ្គលិកអាចឈប់សម្រាកឈឺបានរហូតដល់ ១០ ថ្ងៃក្នុងមួយឆ្នាំ ដោយត្រូវមានវិញ្ញាបនបត្រពេទ្យ។

## ម៉ោងធ្វើការ

ម៉ោងធ្វើការធម្មតាគឺចាប់ពីម៉ោង ៨ ព្រឹក ដល់ម៉ោង ៥ ល្ងាច ពីថ្ងៃច័ន្ទដល់ថ្ងៃសុក្រ។ ការសម្រាកអាហារថ្ងៃត្រង់មានរយៈពេលមួយម៉ោង។

## ប្រាក់រង្វាន់

ប្រាក់រង្វាន់ប្រចាំឆ្នាំត្រូវបានបើកនៅខែធ្នូ ហើយស្មើនឹងប្រាក់ខែមួយខែសម្រាប់បុគ្គលិកដែលបានធ្វើការគ្រប់មួយឆ្នាំ។

## សុវត្ថិភាពព័ត៌មាន

រាល់ឧប្បត្តិហេតុសុវត្ថិភាពត្រូវរាយការណ៍ទៅក្រុមសុវត្ថិភាពក្នុងរយៈពេល ៤ ម៉ោង។ ពាក្យសម្ងាត់ត្រូវមានយ៉ាងហោចណាស់ ១៤ តួអក្សរ ហើយត្រូវផ្លាស់ប្តូររៀងរាល់ ៩០ ថ្ងៃម្តង។
"""

MIXED_IT = """# មគ្គុទ្ទេសក៍ IT សម្រាប់បុគ្គលិកថ្មី

## ការតំឡើង VPN

បុគ្គលិកត្រូវប្រើកម្មវិធី WireGuard ដើម្បីភ្ជាប់ទៅបណ្តាញក្រុមហ៊ុនពីចម្ងាយ។ សូមទាញយក configuration file ពី IT portal ហើយ import ចូលក្នុង WireGuard។

## Email និង Multi-factor authentication

គណនី email ក្រុមហ៊ុនត្រូវបើក MFA ជាមួយកម្មវិធី Microsoft Authenticator។ MFA គឺជាកាតព្វកិច្ចសម្រាប់ email, GitLab និង HR portal។

## ការស្នើសុំ Laptop

ការស្នើសុំ laptop ថ្មីត្រូវធ្វើតាមរយៈ ticket ក្នុង ServiceDesk ហើយ IT នឹងរៀបចំឱ្យរួចក្នុងរយៈពេល ៣ ថ្ងៃធ្វើការ។ Laptop ស្តង់ដារគឺ MacBook Air M3។

## Printer

Printer នៅជាន់ទី ៣ មានឈ្មោះ PRN-3F-01។ ដើម្បីបោះពុម្ពពណ៌ ត្រូវមានការអនុញ្ញាតពីប្រធានផ្នែក។
"""

SUPPORT_STANDARD = """Standard Support Plan

The Standard Support Plan is included with every Northwind subscription. Support is available by email from Monday to Friday, 9:00 to 18:00 Indochina Time.

Response times: critical incidents receive a first response within 8 business hours; normal requests within 2 business days.

The Standard Support Plan does not include phone support or a dedicated account manager. Uptime commitment: 99.5% per month.
"""

SUPPORT_PREMIUM = """Premium Support Plan

The Premium Support Plan costs USD 1,500 per month and adds 24/7 phone and email support.

Response times: critical incidents receive a first response within 1 hour, at any time of day; normal requests within 4 business hours.

Premium customers get a dedicated account manager and quarterly architecture reviews. Uptime commitment: 99.95% per month, with service credits of 10% for each 0.1% below the commitment.
"""

PRICE_CSV = """product_code,product_name,unit_price_usd,warranty_months,stock
NR-ARM-200,Robotic Arm 200,12500,24,14
NR-ARM-350,Robotic Arm 350,18900,24,6
NR-SEN-010,Lidar Sensor 10,1450,12,120
NR-SEN-020,Depth Camera 20,890,12,75
NR-CTL-500,Motion Controller 500,3200,36,40
NR-AGV-100,Autonomous Guided Vehicle 100,27400,24,3
NR-BAT-048,Battery Pack 48V,640,6,210
NR-GRP-005,Soft Gripper 5,410,12,95
"""


def _long_manual() -> str:
    """~30 sections of plausible but distinct maintenance content; one deep fact in section 23."""
    parts = ["# Northwind AGV-100 Maintenance Manual\n"]
    topics = [
        "Unpacking", "Site preparation", "Floor requirements", "Charging station", "First power-on", "Network setup",
        "Map creation", "Route planning", "Safety scanners", "Emergency stop", "Payload limits", "Speed zones",
        "Daily inspection", "Weekly inspection", "Wheel maintenance", "Bearing lubrication", "Battery care",
        "Firmware updates", "Error codes A", "Error codes B", "Calibration", "Sensor cleaning",
        "Drive motor replacement", "Brake inspection", "Storage", "Transport", "Decommissioning", "Recycling",
        "Warranty", "Contact",
    ]
    for i, t in enumerate(topics, start=1):
        body = (f"This section explains {t.lower()} for the AGV-100. Operators must follow the steps in order and "
                f"record each step in the maintenance log. Use only Northwind-approved tools and parts. ") * 4
        if t == "Drive motor replacement":
            body += ("The drive motor must be replaced after 12,000 operating hours or when the motor temperature "
                     "exceeds 85 °C during normal operation. Torque the four mounting bolts to 9 Nm. ")
        if t == "Battery care":
            body += "Store batteries at 40 to 60 percent charge and between 10 and 25 °C. "
        parts.append(f"## {i}. {t}\n\n{body.strip()}\n")
    return "\n".join(parts)


DOCS: list[BenchDoc] = [
    BenchDoc("en_handbook.pdf", "PDF", builder="handbook_pdf", tags=["en", "table", "pdf"]),
    BenchDoc("km_hr_policy.md", "MARKDOWN", KM_POLICY, tags=["km"]),
    BenchDoc("mixed_it_guide.md", "MARKDOWN", MIXED_IT, tags=["mixed"]),
    BenchDoc("support_standard.txt", "TXT", SUPPORT_STANDARD, tags=["en", "similar"]),
    BenchDoc("support_premium.txt", "TXT", SUPPORT_PREMIUM, tags=["en", "similar"]),
    BenchDoc("price_list.csv", "CSV", PRICE_CSV, tags=["en", "table"]),
    BenchDoc("agv_manual.md", "MARKDOWN", _long_manual(), tags=["en", "long"]),
]

QUESTIONS: list[BenchQuestion] = [
    # English facts (PDF)
    BenchQuestion("en1", "How many days of paid annual leave do full-time employees receive?", "en", "fact", "en_handbook.pdf", "21 days"),
    BenchQuestion("en2", "Which VPN client is required for remote access?", "en", "fact", "en_handbook.pdf", "WireGuard"),
    BenchQuestion("en3", "How long is parental leave for the primary caregiver?", "en", "fact", "en_handbook.pdf", "90 calendar days"),
    BenchQuestion("en4", "When must expense receipts be submitted?", "en", "fact", "en_handbook.pdf", "30 days"),
    # Tables
    BenchQuestion("tb1", "What is the hotel limit per night in Singapore?", "en", "table", "en_handbook.pdf", "260"),
    BenchQuestion("tb2", "What is the unit price of the Lidar Sensor 10?", "en", "table", "price_list.csv", "1450"),
    BenchQuestion("tb3", "Which product has a 36 month warranty?", "en", "table", "price_list.csv", "Motion Controller 500"),
    # Long document
    BenchQuestion("lg1", "After how many operating hours must the AGV drive motor be replaced?", "en", "long", "agv_manual.md", "12,000 operating hours"),
    BenchQuestion("lg2", "At what charge level should AGV batteries be stored?", "en", "long", "agv_manual.md", "40 to 60 percent"),
    # Similar terminology
    BenchQuestion("sm1", "What is the first response time for critical incidents on the Premium Support Plan?", "en", "similar", "support_premium.txt", "within 1 hour"),
    BenchQuestion("sm2", "What is the first response time for critical incidents on the Standard Support Plan?", "en", "similar", "support_standard.txt", "8 business hours"),
    BenchQuestion("sm3", "What uptime does the Standard plan commit to?", "en", "similar", "support_standard.txt", "99.5%"),
    # Khmer
    BenchQuestion("km1", "តើបុគ្គលិកពេញម៉ោងទទួលបានការឈប់សម្រាកប្រចាំឆ្នាំប៉ុន្មានថ្ងៃ?", "km", "fact", "km_hr_policy.md", "២១ ថ្ងៃ"),
    BenchQuestion("km2", "តើការឈប់សម្រាកឈឺអាចមានប៉ុន្មានថ្ងៃក្នុងមួយឆ្នាំ?", "km", "fact", "km_hr_policy.md", "១០ ថ្ងៃ"),
    BenchQuestion("km3", "តើម៉ោងធ្វើការធម្មតាចាប់ផ្តើមនៅម៉ោងប៉ុន្មាន?", "km", "fact", "km_hr_policy.md", "ម៉ោង ៨ ព្រឹក"),
    BenchQuestion("km4", "តើប្រាក់រង្វាន់ប្រចាំឆ្នាំត្រូវបានបើកនៅខែណា?", "km", "fact", "km_hr_policy.md", "ខែធ្នូ"),
    BenchQuestion("km5", "តើពាក្យសម្ងាត់ត្រូវផ្លាស់ប្តូររៀងរាល់ប៉ុន្មានថ្ងៃ?", "km", "fact", "km_hr_policy.md", "៩០ ថ្ងៃ"),
    # Mixed Khmer-English
    BenchQuestion("mx1", "តើត្រូវប្រើកម្មវិធីអ្វីសម្រាប់ VPN?", "mixed", "fact", "mixed_it_guide.md", "WireGuard"),
    BenchQuestion("mx2", "តើ laptop ស្តង់ដារជាម៉ាកអ្វី?", "mixed", "fact", "mixed_it_guide.md", "MacBook Air M3"),
    BenchQuestion("mx3", "Which authenticator app is used for MFA?", "mixed", "fact", "mixed_it_guide.md", "Microsoft Authenticator"),
    BenchQuestion("mx4", "តើ printer នៅជាន់ទី ៣ មានឈ្មោះអ្វី?", "mixed", "fact", "mixed_it_guide.md", "PRN-3F-01"),
    # Absent answers
    BenchQuestion("ab1", "What was Northwind's total revenue in 2023?", "en", "absent"),
    BenchQuestion("ab2", "What is the company's policy on bringing pets to the office?", "en", "absent"),
    BenchQuestion("ab3", "តើក្រុមហ៊ុនមានបុគ្គលិកប៉ុន្មាននាក់?", "km", "absent"),
]
