"""Run in the isolated worker, never on the API event loop."""

import base64
import csv
import hashlib
import io
import warnings
from collections.abc import Callable
from typing import Any

from attachments.ocr import OCR_LANGUAGES, OCR_LAYOUTS, LocalOcr, OcrUnavailable, sample_indices

MAX_BYTES = 2 * 1024 * 1024
MAX_CHARS = 40_000
TYPES = {
    "txt": {"text/plain"},
    "csv": {"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"},
    "pdf": {"application/pdf"},
    "jpg": {"image/jpeg"},
    "jpeg": {"image/jpeg"},
    "png": {"image/png"},
    "gif": {"image/gif"},
}


def coverage_unit(index: int, kind: str, native: str, reason: str) -> dict[str, Any]:
    return {
        "index": index + 1,
        "kind": kind,
        "nativeStatus": native,
        "rasterStatus": "NOT_APPLICABLE",
        "ocrAttempted": False,
        "ocrCompleted": False,
        "ocrStatus": "SKIPPED",
        "reason": reason,
    }


def read_selected(
    selected: list[int],
    coverage: list[dict[str, Any]],
    language: str,
    layout: str,
    read: Callable[[LocalOcr, int], str],
) -> tuple[dict[int, str], str]:
    """One engine/deadline per attachment. Preserve earlier output on safe failures."""
    parts: dict[int, str] = {}
    if not selected:
        return parts, ""
    try:
        ocr = LocalOcr(language, layout)
    except OcrUnavailable as error:
        for index in selected:
            coverage[index]["reason"] = error.reason
        return parts, str(error)
    detail = ocr.notice
    stop = None
    for index in selected:
        unit = coverage[index]
        if stop:
            unit["reason"] = stop
            continue
        unit["ocrAttempted"] = True
        try:
            text = read(ocr, index)
            unit.update(
                ocrCompleted=True,
                ocrStatus="READ" if text else "EMPTY",
                reason="TEXT_FOUND" if text else "EMPTY_RESULT",
            )
            parts[index] = text
        except OcrUnavailable as error:
            unit.update(ocrStatus="FAILED", reason=error.reason)
            if str(error) not in detail:
                detail += " " + str(error)
            if error.reason in {"BUDGET_EXHAUSTED", "TOOL_UNAVAILABLE", "LANGUAGE_UNAVAILABLE"}:
                stop = error.reason
        except (OSError, UnicodeError):
            unit.update(ocrStatus="FAILED", reason="TOOL_FAILED")
    return parts, detail


def extract(data: dict) -> dict:  # type: ignore[type-arg]
    language, layout = data.get("ocrLanguage", "mixed"), data.get("ocrLayout", "general")
    if (
        not isinstance(language, str)
        or not isinstance(layout, str)
        or language not in OCR_LANGUAGES
        or layout not in OCR_LAYOUTS
    ):
        raise ValueError("OCR_OPTIONS_UNSUPPORTED")
    name, mime = data["name"], data.get("mediaType", "").lower().split(";", 1)[0].strip()
    if (
        not isinstance(name, str)
        or not 1 <= len(name) <= 180
        or any(c in name for c in "/\\:")
        or any(ord(c) < 32 or ord(c) == 127 for c in name)
    ):  # noqa: E501
        raise ValueError("INVALID_FILENAME")
    extension = name.rsplit(".", 1)[-1].lower()
    if extension not in TYPES or mime not in TYPES[extension] | {"", "application/octet-stream"}:
        raise ValueError("UNSUPPORTED_TYPE_OR_MIME")
    try:
        payload = base64.b64decode(data["base64"], validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("INVALID_BASE64") from error
    if not 0 < len(payload) <= MAX_BYTES:
        raise ValueError("FILE_SIZE_LIMIT")
    result: dict[str, Any] = {
        "name": name,
        "mediaType": mime or "application/octet-stream",
        "size": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "status": "COMPLETE",
        "text": "",
        "notice": "",
        "encoding": None,
        "delimiter": None,
        "units": 1,
        "ocrLanguage": language,
        "ocrLayout": layout,
        "coverage": [],
    }
    if extension in {"txt", "csv"}:
        text, encoding = decode_text(payload, data.get("encoding", "auto"))
        if len(text) > MAX_CHARS:
            raise ValueError("EXTRACTED_TEXT_LIMIT")
        if not text.strip() or any(ord(c) < 32 and c not in "\t\r\n\f" for c in text):
            raise ValueError("NOT_PLAIN_TEXT")
        if payload.startswith((b"%PDF-", b"PK\x03\x04", b"\x89PNG", b"GIF87a", b"GIF89a", b"\xff\xd8")):
            raise ValueError("FORMAT_MISMATCH")
        result.update(text=text, encoding=encoding)
        if encoding == "cp949":
            result["notice"] = "CP949 decoded; verify the preview if the original encoding is uncertain."
        if extension == "csv":
            delimiter = data.get("delimiter", "auto")
            if delimiter == "auto":
                candidates = []
                for candidate in (",", "\t", ";", "|"):
                    try:
                        trial = list(csv.reader(io.StringIO(text, newline=""), delimiter=candidate, strict=True))
                        widths = {len(row) for row in trial if row}
                        if len(widths) == 1 and next(iter(widths)) > 1:
                            candidates.append(candidate)
                    except csv.Error:
                        continue
                if len(candidates) != 1:
                    raise ValueError("CSV_DELIMITER_REQUIRED")
                delimiter = candidates[0]
            if delimiter not in {",", "\t", ";", "|"}:
                raise ValueError("CSV_DELIMITER_REQUIRED")
            rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True))
            if len(rows) > 5000 or any(len(row) > 200 for row in rows):
                raise ValueError("CSV_DIMENSION_LIMIT")
            result.update(delimiter=delimiter, units=len(rows))
    elif extension == "pdf":
        if not payload.startswith(b"%PDF-") or b"%%EOF" not in payload[-1024:]:
            raise ValueError("FORMAT_MISMATCH")
        from pypdf import PdfReader, filters
        from pypdf.errors import PdfReadError

        from attachments.pdf_coverage import additional_ocr, raster_kind

        filters.ZLIB_MAX_OUTPUT_LENGTH = 4 * 1024 * 1024
        reader = PdfReader(io.BytesIO(payload), strict=True)
        if reader.is_encrypted:
            raise ValueError("ENCRYPTED_PDF_UNSUPPORTED")
        count = len(reader.pages)
        if not 0 < count <= 30:
            raise ValueError("PDF_PAGE_LIMIT")
        parts, length, ocr_candidates, coverage = [], 0, [], []
        for index, page in enumerate(reader.pages):
            native_status = "EMPTY"
            try:
                part = page.extract_text() or ""
                if part.strip():
                    native_status = "TEXT"
            except (PdfReadError, ValueError, RecursionError):
                part, native_status = "", "FAILED"
            raster = raster_kind(page)
            eligible = not part.strip() or raster in {"LARGE", "UNKNOWN"}
            reason = "SAMPLED_OUT" if eligible else "SMALL_RASTER" if raster == "SMALL" else "TEXT_ONLY"
            coverage.append(coverage_unit(index, "PAGE", native_status, reason))
            coverage[-1]["rasterStatus"] = raster
            if eligible:
                ocr_candidates.append(index)
            length += len(part) + 2
            if length > MAX_CHARS:
                raise ValueError("EXTRACTED_TEXT_LIMIT")
            parts.append(part)
        selected = [ocr_candidates[sample] for sample in sample_indices(len(ocr_candidates))]
        recognized, detail = read_selected(
            selected,
            coverage,
            language,
            layout,
            lambda ocr, index: ocr.read_pdf_page(payload, index + 1),
        )
        for index, part in recognized.items():
            if not part:
                continue
            if parts[index].strip():
                extra = additional_ocr(parts[index], part)
                if extra:
                    parts[index] = f"[Native text]\n{parts[index]}\n[Additional OCR; may overlap native text]\n{extra}"
                else:
                    coverage[index]["reason"] = "DUPLICATE_ONLY"
            else:
                parts[index] = part
        attempted = [unit["index"] for unit in coverage if unit["ocrAttempted"]]
        completed = sum(unit["ocrCompleted"] for unit in coverage)
        text = "\n\n".join(f"[Page {index + 1}]\n{part}" for index, part in enumerate(parts) if part.strip())
        if len(text) > MAX_CHARS:
            raise ValueError("EXTRACTED_TEXT_LIMIT")
        result.update(
            text=text,
            units=count,
            coverage=coverage,
            status="PARTIAL" if text else "UNSUPPORTED",
            notice=(
                f"Text layer found on {sum(unit['nativeStatus'] == 'TEXT' for unit in coverage)}/{count} pages. "
                f"Scan OCR attempted on {len(attempted)}/{len(ocr_candidates)} candidate pages"
                f" (page numbers: {', '.join(map(str, attempted)) or 'none'}); "
                f"completed on {completed} page(s). "
                "Candidates include text-empty pages and large painted raster images. "
                "Unsampled pages, small images and annotations may contain unread text. "
                "See per-page coverage. Visual content and layout are not fully read. " + detail
            ).strip(),
        )
    else:
        from PIL import Image

        Image.MAX_IMAGE_PIXELS = 16_000_000
        expected = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "gif": "GIF"}[extension]
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as picture:
                if picture.format != expected:
                    raise ValueError("FORMAT_MISMATCH")
                picture.verify()
            with Image.open(io.BytesIO(payload)) as picture:
                count, pixels = 0, 0
                while True:
                    count += 1
                    pixels += picture.width * picture.height
                    if count > 60 or pixels > 32_000_000 or picture.width * picture.height > 16_000_000:
                        raise ValueError("IMAGE_FRAME_OR_PIXEL_LIMIT")
                    picture.load()
                    try:
                        picture.seek(count)
                    except EOFError:
                        break
        coverage = [coverage_unit(index, "FRAME", "NOT_APPLICABLE", "SAMPLED_OUT") for index in range(count)]
        with Image.open(io.BytesIO(payload)) as picture:

            def read_frame(ocr: LocalOcr, index: int) -> str:
                picture.seek(index)
                return ocr.read_image(picture)

            frame_parts, detail = read_selected(sample_indices(count), coverage, language, layout, read_frame)
        attempted = [unit["index"] for unit in coverage if unit["ocrAttempted"]]
        frame_recognized = [index for index, part in frame_parts.items() if part]
        text = "\n\n".join(f"[Frame {index + 1}]\n{part}" for index, part in frame_parts.items() if part)
        if len(text) > MAX_CHARS:
            raise ValueError("EXTRACTED_TEXT_LIMIT")
        result.update(
            status="PARTIAL" if text else "UNSUPPORTED",
            text=text,
            units=count,
            coverage=coverage,
            notice=(
                f"Validated {count} frame(s). Text OCR attempted on {len(attempted)}/{count} frames"
                f" (frame numbers: {', '.join(map(str, attempted)) or 'none'}); "
                f"text found in {len(frame_recognized)} frame(s). "
                "See per-frame attempted/completed status. "
                "Unsampled frames were not read. No visual or animation understanding. " + detail
            ).strip(),
        )
    return result


def decode_text(payload: bytes, encoding: str) -> tuple[str, str]:
    if encoding not in {"auto", "utf-8", "utf-16", "cp949"}:
        raise ValueError("TEXT_ENCODING_UNSUPPORTED")
    if encoding == "auto":
        if payload.startswith((b"\xff\xfe", b"\xfe\xff")):
            encoding = "utf-16"
        else:
            try:
                return payload.decode("utf-8"), "utf-8"
            except UnicodeDecodeError:
                encoding = "cp949"
    try:
        return payload.decode(encoding), encoding
    except UnicodeDecodeError as error:
        raise ValueError("TEXT_ENCODING_UNSUPPORTED") from error
