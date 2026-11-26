"""Link import: SSRF guard, redirects, limits, content-type detection, HTML main-text extraction."""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.core.config import Settings
from app.core.errors import DocumentParseError, UrlImportError
from app.parsing.base import get_parser
from app.web import fetcher
from app.web.fetcher import detect_file_type, fetch_url, is_blocked_address, page_title, validate_url

PAGE = b"""<html><head><title>Leave Policy | ACME</title></head><body>
<nav>Home About Careers Contact</nav>
<main><h1>Leave policy</h1>
<p>Full-time employees receive 21 days of paid annual leave per calendar year. Unused days carry over.</p>
<h2>Sick leave</h2><p>Employees get 10 days of paid sick leave; a certificate is needed after 2 days.</p>
<table><tr><th>Type</th><th>Days</th></tr><tr><td>Annual</td><td>21</td></tr><tr><td>Sick</td><td>10</td></tr></table>
</main><footer>Copyright 2026 ACME. Cookie settings.</footer></body></html>"""


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence
        pass

    def do_GET(self):  # noqa: N802
        port = self.server.server_address[1]
        routes = {
            "/page": (200, "text/html; charset=utf-8", PAGE),
            "/doc.pdf": (200, "application/octet-stream", b"%PDF-1.4 tiny"),
            "/image": (200, "image/png", b"\x89PNG...."),
            "/big": (200, "text/plain", b"x" * 5000),
            "/missing": (404, "text/html", b"nope"),
        }
        if self.path == "/redirect":
            self._redirect("/page")
        elif self.path == "/loop":
            self._redirect("/loop")
        elif self.path == "/to-localhost":
            self._redirect(f"http://localhost:{port}/page")
        else:
            status, ctype, body = routes.get(self.path, (404, "text/plain", b"not found"))
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def _redirect(self, location: str):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()


@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def _settings(allow_private: bool) -> Settings:
    return Settings(url_import_allow_private=allow_private, url_import_timeout_seconds=5, url_import_max_redirects=3)


# ------------------------------------------------------------------------------------------- SSRF guard
@pytest.mark.parametrize("ip", ["127.0.0.1", "10.1.2.3", "172.17.0.2", "192.168.1.10", "169.254.169.254",
                                "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1",
                                "::ffff:10.0.0.1", "224.0.0.1", "2002:7f00:1::"])
def test_private_addresses_blocked(ip):
    assert is_blocked_address(ip)


@pytest.mark.parametrize("ip", ["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111"])
def test_public_addresses_allowed(ip):
    assert not is_blocked_address(ip)


@pytest.mark.parametrize("url", ["", "ftp://example.com/a", "file:///etc/passwd", "javascript:alert(1)",
                                 "http://user:pw@example.com/", "http:///nohost", "https://" + "a" * 2050,
                                 "http://example.com:99999/"])
def test_invalid_urls_rejected(url):
    with pytest.raises(UrlImportError) as e:
        validate_url(url)
    assert e.value.code == "URL_INVALID"


def test_valid_url_normalised():
    assert validate_url("HTTPS://Example.COM/a?b=1") == ("https", "example.com", 443)
    assert validate_url("http://bücher.example/x")[1] == "xn--bcher-kva.example"


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://localhost:8080/", "http://[::1]/",
                                 "http://169.254.169.254/latest/meta-data/", "http://0.0.0.0/"])
async def test_fetch_refuses_local_targets(url):
    with pytest.raises(UrlImportError) as e:
        await fetch_url(url, _settings(False), 10_000)
    assert e.value.code == "URL_BLOCKED"


async def test_redirect_hops_are_revalidated(server, monkeypatch):
    """The first host is allowed (test server), but its redirect to 'localhost' must be re-checked and refused."""
    original = fetcher.resolve_public

    async def only_first_host_allowed(host, port, allow_private):
        return await original(host, port, host == "127.0.0.1")

    monkeypatch.setattr(fetcher, "resolve_public", only_first_host_allowed)
    with pytest.raises(UrlImportError) as e:
        await fetch_url(f"{server}/to-localhost", _settings(False), 10_000)
    assert e.value.code == "URL_BLOCKED"


# ---------------------------------------------------------------------------------------------- fetching
async def test_fetch_html_follows_redirect(server):
    page = await fetch_url(f"{server}/redirect", _settings(True), 100_000)
    assert page.file_type == "HTML" and page.url.endswith("/page") and page.data == PAGE
    assert page.title == "Leave policy" or page.title.startswith("Leave Policy")


async def test_fetch_pdf_by_extension(server):
    page = await fetch_url(f"{server}/doc.pdf", _settings(True), 100_000)
    assert page.file_type == "PDF" and page.title == "doc.pdf"


@pytest.mark.parametrize("path,code", [("/image", "URL_UNSUPPORTED"), ("/missing", "URL_FETCH_FAILED"),
                                       ("/loop", "URL_FETCH_FAILED"), ("/big", "URL_TOO_LARGE")])
async def test_fetch_failures(server, path, code):
    with pytest.raises(UrlImportError) as e:
        await fetch_url(f"{server}{path}", _settings(True), 1000)
    assert e.value.code == code


def test_detect_file_type():
    assert detect_file_type("text/html; charset=utf-8", "https://x/a") == "HTML"
    assert detect_file_type("application/octet-stream", "https://x/report.DOCX") == "DOCX"
    assert detect_file_type("text/x-python", "https://x/a.py") == "TXT"
    assert detect_file_type("image/jpeg", "https://x/a.jpg") is None


def test_page_title_fallbacks():
    assert page_title("HTML", b"<html><head><title> A &amp; B </title></head><body></body></html>", "https://x/") == "A & B"
    assert page_title("HTML", b"<p>no title</p>", "https://example.com/docs/") == "example.com/docs"


# ----------------------------------------------------------------------------------------------- parsing
def test_html_parser_keeps_main_content_headings_and_tables():
    parsed = get_parser("HTML").parse(PAGE, "page.html")
    text = "\n".join(s.text for s in parsed.segments)
    headings = [s.heading for s in parsed.segments if s.kind == "heading"]
    assert "Leave policy" in headings and "Sick leave" in headings
    assert "21 days of paid annual leave" in text and "| Annual | 21 |" in text
    assert "Careers" not in text and "Cookie settings" not in text


def test_html_parser_strips_wiki_noise_and_footnote_markers():
    html = (b"<html><body><article><h2>History<span>[edit]</span></h2><p>Angkor Wat was built in the 12th century"
            b"<sup>[4]</sup> by king Suryavarman II.<sup>[a]</sup> It faces west.[citation needed]</p></article></body></html>")
    text = "\n".join(s.text for s in get_parser("HTML").parse(html, "w.html").segments)
    assert "12th century by king Suryavarman II." in text.replace("  ", " ") and "It faces west." in text
    assert "[edit]" not in text and "[4]" not in text and "[a]" not in text and "citation needed" not in text


def test_html_parser_rejects_pages_without_text():
    js_app = b"<html><head><title>App</title></head><body><div id='root'></div><script>load()</script></body></html>"
    with pytest.raises(DocumentParseError):
        get_parser("HTML").parse(js_app, "app.html")


PORTFOLIO = b"""<html><head><title>Sokha - Developer</title><script>window.__DATA__={"secret":"x"}</script>
<style>.a{color:red}</style></head><body>
<header><nav><a href="#about">About</a><a href="#projects">Projects</a></nav>
<p>Software engineer in Phnom Penh</p><h1>Hi, I'm Sokha. I build web and AI software.</h1></header>
<section id="about"><h2>About me</h2><p>I am a final-year student at a university in Siem Reap.</p>
<p>I like Java, Spring Boot and PostgreSQL.</p></section>
<section><h3>Skills</h3><div>Backend</div><ul><li>Java</li><li>Spring Boot</li></ul><div>Data</div><ul><li>pgvector</li></ul></section>
<section id="projects"><h2>Projects</h2>
<article><h3>EventPass</h3><p>An event ticketing platform for Cambodia with KHQR payments and door scanning at
the venue, built with Spring Boot and Next.js, deployed with Docker Compose on a small VPS.</p></article>
<article><h3>LedgerLite</h3><p>An AI-powered financial management platform for small businesses in Cambodia,
with OCR of receipts and automated bookkeeping, helping owners understand cash flow every week.</p></article>
</section>
<div hidden>Hidden draft text</div><div aria-hidden="true">decorative</div>
<form><label>Your email</label><input name="email"><button>Send</button></form>
<footer><p>Contact: sokha at example.com</p></footer></body></html>"""


def test_html_parser_uses_full_page_when_article_extraction_is_partial(monkeypatch):
    """Real one-page sites (e.g. portfolios) make trafilatura keep a single card (7% of the text in testing)."""
    import trafilatura

    monkeypatch.setattr(trafilatura, "extract", lambda *a, **k: "### LedgerLite\n\nAn AI-powered financial platform.")
    parsed = get_parser("HTML").parse(PORTFOLIO, "portfolio.html")
    text = "\n".join(s.text for s in parsed.segments)
    headings = [s.heading for s in parsed.segments if s.kind == "heading"]
    assert parsed.metadata["extraction"] == "full_page"
    assert "Hi, I'm Sokha. I build web and AI software." in headings and "About me" in headings
    assert "final-year student at a university in Siem Reap" in text
    assert "EventPass" in headings and "LedgerLite" in headings
    assert "- Java\n- Spring Boot" in text
    for absent in ("__DATA__", "color:red", "Hidden draft", "decorative", "Your email", "About\nProjects"):
        assert absent not in text


def test_html_parser_keeps_article_extraction_for_articles():
    assert get_parser("HTML").parse(PAGE, "page.html").metadata["extraction"] == "article"
