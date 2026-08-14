"""Bounded direct HTTP and PDF collection for known allowlisted URLs."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from html.parser import HTMLParser
from io import BytesIO
from urllib.parse import urljoin

import httpx
from pypdf import PdfReader

from .contracts import FetchRequest, WebDocument, WebProvider, web_url
from .security import UrlSecurityPolicy, detect_prompt_injection


class DirectFetchError(RuntimeError):
    pass


class DirectHttpProvider:
    _ALLOWED_CONTENT_TYPES = {"text/html", "text/plain", "application/pdf"}

    def __init__(self, client: httpx.AsyncClient | None = None, security: UrlSecurityPolicy | None = None, max_bytes: int = 5_000_000, max_pdf_pages: int = 200) -> None:  # noqa: E501
        if max_bytes < 1 or max_pdf_pages < 1:
            raise ValueError("fetch limits must be positive")

        self._client = client
        self._security = security or UrlSecurityPolicy()
        self._max_bytes = max_bytes
        self._max_pdf_pages = max_pdf_pages

    async def fetch(self, request: FetchRequest) -> WebDocument:
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=5.0),
            follow_redirects=False,
            headers={"User-Agent": "FreelanceOpsResearchBot/2.0"}
        )

        owns_client = self._client is None
        try:
            source_url = str(request.url)
            final_url, content_type, payload = await self._download(client, source_url, request.allowed_domains)
            title, content, parser_version = self._parse(payload, content_type)
            normalized = content.strip()
            if not normalized:
                raise DirectFetchError("collected document is empty")

            return WebDocument(
                source_url=web_url(source_url),
                final_url=web_url(final_url),
                title=title or final_url,
                content=normalized[:200000],
                content_type=content_type,
                content_sha256=hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
                fetched_at=datetime.now(UTC),
                parser_version=parser_version,
                provider=WebProvider.DIRECT_HTTP,
                jurisdiction=request.jurisdiction,
                document_type=request.document_type,
                authority_level=request.authority_level,
                prompt_injection_signals=detect_prompt_injection(normalized)
            )
        finally:
            if owns_client:
                await client.aclose()

    async def _download(self, client: httpx.AsyncClient, source_url: str, allowed_domains: list[str]) -> tuple[str, str, bytes]:  # noqa: E501
        current_url = source_url
        accept_headers = {"Accept": "text/html,text/plain,application/pdf"}
        for _ in range(4):
            current_url = await self._security.validate(current_url, allowed_domains)
            async with client.stream("GET", current_url, headers=accept_headers) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise DirectFetchError("redirect response did not contain a location")

                    current_url = urljoin(current_url, location)
                    continue

                if response.status_code < 200 or response.status_code >= 300:
                    raise DirectFetchError(f"web source returned status {response.status_code}")

                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                if content_type not in self._ALLOWED_CONTENT_TYPES:
                    raise DirectFetchError("web source content type is forbidden")

                declared_length = response.headers.get("content-length")
                if declared_length is not None:
                    try:
                        declared_bytes = int(declared_length)
                    except ValueError as error:
                        raise DirectFetchError("web source returned an invalid content length") from error

                    if declared_bytes < 0 or declared_bytes > self._max_bytes:
                        raise DirectFetchError("web source exceeds the byte limit")

                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > self._max_bytes:
                        raise DirectFetchError("web source exceeds the byte limit")

                    chunks.append(chunk)

                return str(response.url), content_type, b"".join(chunks)

        raise DirectFetchError("web source exceeded the redirect limit")

    def _parse(self, payload: bytes, content_type: str) -> tuple[str, str, str]:
        if content_type == "application/pdf":
            return self._parse_pdf(payload)

        text = payload.decode("utf-8", errors="replace")
        if content_type == "text/plain":
            return "", text, "plain-text-v1"

        parser = _VisibleTextParser()
        parser.feed(text)
        return parser.title, parser.content, "stdlib-html-v1"

    def _parse_pdf(self, payload: bytes) -> tuple[str, str, str]:
        try:
            reader = PdfReader(BytesIO(payload), strict=True)
            if len(reader.pages) > self._max_pdf_pages:
                raise DirectFetchError("PDF exceeds the page limit")

            content = "\n\n".join(page.extract_text() or "" for page in reader.pages)
            title = str(reader.metadata.title or "") if reader.metadata is not None else ""
            return title, content, "pypdf-v1"

        except DirectFetchError:
            raise

        except Exception as error:
            raise DirectFetchError("PDF could not be parsed safely") from error


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._ignored_depth = 0
        self._in_title = False
        self._title_parts: list[str] = []
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs

        if tag in {"script", "style", "noscript", "svg"}:
            self._ignored_depth += 1

        if tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self._ignored_depth > 0:
            self._ignored_depth -= 1

        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        value = " ".join(data.split())
        if not value or self._ignored_depth:
            return

        if self._in_title:
            self._title_parts.append(value)

        else:
            self._parts.append(value)

    @property
    def title(self) -> str:
        return " ".join(self._title_parts)[:500]

    @property
    def content(self) -> str:
        return "\n".join(self._parts)
