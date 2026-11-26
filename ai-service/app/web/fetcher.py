"""Fetch a user-supplied link for import, with SSRF protection (ADR-018).

* Only http/https, no credentials in the URL, at most 2048 characters.
* The host is resolved here and EVERY resolved address must be public (not loopback, private, link-local,
  CGNAT, multicast or reserved) unless URL_IMPORT_ALLOW_PRIVATE is set.
* The connection is made to the validated IP itself (Host header + TLS SNI/certificate check use the hostname),
  so a DNS answer cannot change between the check and the connection (DNS rebinding).
* Redirects are followed manually and every hop is re-validated; size, time and redirect count are capped.
* Proxy environment variables are ignored (trust_env=False) so requests cannot be routed around the checks.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
from dataclasses import dataclass
from html import unescape
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

import httpx

from app.core.config import Settings
from app.core.errors import UrlImportError

log = logging.getLogger(__name__)

MAX_URL_LENGTH = 2048
USER_AGENT = "HaieRag/1.0 (self-hosted knowledge base; link import)"

_MIME_TYPES = {
    "text/html": "HTML",
    "application/xhtml+xml": "HTML",
    "application/pdf": "PDF",
    "text/plain": "TXT",
    "text/markdown": "MARKDOWN",
    "text/x-markdown": "MARKDOWN",
    "text/csv": "CSV",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
}
_EXTENSIONS = {
    "html": "HTML", "htm": "HTML", "pdf": "PDF", "txt": "TXT", "md": "MARKDOWN", "markdown": "MARKDOWN",
    "csv": "CSV", "docx": "DOCX", "xlsx": "XLSX", "pptx": "PPTX",
}
_GENERIC_MIME = {"", "application/octet-stream", "binary/octet-stream", "application/download"}
FILE_EXTENSION = {"HTML": "html", "PDF": "pdf", "TXT": "txt", "MARKDOWN": "md", "CSV": "csv",
                  "DOCX": "docx", "XLSX": "xlsx", "PPTX": "pptx"}


@dataclass
class FetchedUrl:
    url: str            # final URL after redirects
    file_type: str
    content_type: str
    data: bytes
    title: str


def is_blocked_address(ip: str) -> bool:
    addr = ipaddress.ip_address(ip.split("%", 1)[0])
    if isinstance(addr, ipaddress.IPv6Address):
        mapped = addr.ipv4_mapped or addr.sixtofour
        if mapped is not None:
            addr = mapped
    return (not addr.is_global) or addr.is_multicast or addr.is_reserved or addr.is_loopback or addr.is_link_local


def validate_url(url: str) -> tuple[str, str, int]:
    """Returns (scheme, ascii hostname, port) or raises UrlImportError."""
    url = (url or "").strip()
    if not url:
        raise UrlImportError("Enter a link to import.", "URL_INVALID")
    if len(url) > MAX_URL_LENGTH:
        raise UrlImportError("The link is too long.", "URL_INVALID")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise UrlImportError("The link is not a valid URL.", "URL_INVALID") from exc
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise UrlImportError("Only http:// and https:// links can be imported.", "URL_INVALID")
    if parts.username is not None or parts.password is not None:
        raise UrlImportError("Links containing a username or password are not allowed.", "URL_INVALID")
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise UrlImportError("The link has no host name.", "URL_INVALID")
    try:
        host = host.encode("idna").decode("ascii") if not _is_ip(host) else host
    except UnicodeError as exc:
        raise UrlImportError("The link's host name is not valid.", "URL_INVALID") from exc
    return scheme, host, port or (443 if scheme == "https" else 80)


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


async def resolve_public(host: str, port: int, allow_private: bool) -> str:
    """Resolve and check every address; return the one to connect to."""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UrlImportError(f"The host {host} could not be found.", "URL_FETCH_FAILED") from exc
    addresses = list(dict.fromkeys(info[4][0] for info in infos))
    if not addresses:
        raise UrlImportError(f"The host {host} could not be found.", "URL_FETCH_FAILED")
    if not allow_private and any(is_blocked_address(a) for a in addresses):
        raise UrlImportError("Links to local or private network addresses are not allowed.", "URL_BLOCKED")
    # prefer IPv4 (Docker Desktop networks often lack IPv6 egress)
    return next((a for a in addresses if ":" not in a), addresses[0])


def detect_file_type(content_type: str, url: str) -> str | None:
    mime = content_type.split(";", 1)[0].strip().lower()
    if mime in _MIME_TYPES:
        return _MIME_TYPES[mime]
    if mime in _GENERIC_MIME or mime.startswith("text/"):
        path = urlsplit(url).path
        ext = path.rsplit(".", 1)[-1].lower() if "." in path.rsplit("/", 1)[-1] else ""
        if ext in _EXTENSIONS:
            return _EXTENSIONS[ext]
        if mime.startswith("text/"):
            return "TXT"
    return None


_TITLE = re.compile(rb"<title[^>]*>(.*?)</title\s*>", re.IGNORECASE | re.DOTALL)


def page_title(file_type: str, data: bytes, url: str) -> str:
    title = ""
    if file_type == "HTML":
        try:
            import trafilatura

            meta = trafilatura.extract_metadata(data)
            title = (meta.title or "") if meta else ""
        except Exception:  # noqa: BLE001 - metadata is best effort
            title = ""
        if not title:
            m = _TITLE.search(data[:256 * 1024])
            if m:
                title = unescape(m.group(1).decode("utf-8", "replace"))
    else:
        last = unquote(urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1])
        title = last
    title = re.sub(r"\s+", " ", title).strip()
    if not title:
        parts = urlsplit(url)
        title = (parts.hostname or "page") + (parts.path.rstrip("/") or "")
    return title[:255]


async def fetch_url(url: str, settings: Settings, max_bytes: int) -> FetchedUrl:
    try:
        async with asyncio.timeout(settings.url_import_timeout_seconds):
            return await _fetch(url, settings, max_bytes)
    except TimeoutError as exc:
        raise UrlImportError("The site took too long to respond.", "URL_FETCH_FAILED") from exc


async def _fetch(url: str, settings: Settings, max_bytes: int) -> FetchedUrl:
    timeout = httpx.Timeout(settings.url_import_timeout_seconds, connect=10.0)
    async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=timeout) as client:
        current = url.strip()
        for _ in range(settings.url_import_max_redirects + 1):
            scheme, host, port = validate_url(current)
            ip = await resolve_public(host, port, settings.url_import_allow_private)
            parts = urlsplit(current)
            default_port = port == (443 if scheme == "https" else 80)
            ip_netloc = (f"[{ip}]" if ":" in ip else ip) + ("" if default_port else f":{port}")
            target = urlunsplit((scheme, ip_netloc, parts.path or "/", parts.query, ""))
            headers = {
                "Host": host if default_port else f"{host}:{port}",
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5",
            }
            extensions = {"sni_hostname": host} if scheme == "https" else {}
            request = client.build_request("GET", target, headers=headers, extensions=extensions)
            try:
                response = await client.send(request, stream=True)
            except httpx.ConnectError as exc:
                msg = "The site's security certificate is not valid." if "CERTIFICATE" in str(exc).upper() \
                    else "Could not connect to the site."
                raise UrlImportError(msg, "URL_FETCH_FAILED") from exc
            except httpx.HTTPError as exc:
                raise UrlImportError("Could not download the page.", "URL_FETCH_FAILED") from exc
            try:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise UrlImportError("The site sent an invalid redirect.", "URL_FETCH_FAILED")
                    current = urljoin(current, location)
                    continue
                if response.status_code >= 400:
                    raise UrlImportError(f"The site returned HTTP {response.status_code}.", "URL_FETCH_FAILED")
                content_type = response.headers.get("content-type", "")
                file_type = detect_file_type(content_type, current)
                if file_type is None:
                    shown = content_type.split(";", 1)[0] or "unknown"
                    raise UrlImportError(f"This link points to an unsupported content type ({shown}). Supported: "
                                         "web pages, PDF, DOCX, XLSX, PPTX, TXT, Markdown, CSV.", "URL_UNSUPPORTED")
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > max_bytes:
                    raise _too_large(max_bytes)
                buf = bytearray()
                async for piece in response.aiter_bytes():
                    buf.extend(piece)
                    if len(buf) > max_bytes:
                        raise _too_large(max_bytes)
                if not buf:
                    raise UrlImportError("The page is empty.", "URL_FETCH_FAILED")
                data = bytes(buf)
                mime = content_type.split(";", 1)[0].strip().lower() or "application/octet-stream"
                log.info("fetched link", extra={"host": host, "file_type": file_type, "bytes": len(data)})
                return FetchedUrl(current, file_type, mime, data, page_title(file_type, data, current))
            except httpx.HTTPError as exc:
                raise UrlImportError("The download was interrupted.", "URL_FETCH_FAILED") from exc
            finally:
                await response.aclose()
        raise UrlImportError("The link redirects too many times.", "URL_FETCH_FAILED")


def _too_large(max_bytes: int) -> UrlImportError:
    return UrlImportError(f"The linked content is larger than {max_bytes // (1024 * 1024)} MB.", "URL_TOO_LARGE")
