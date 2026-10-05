"""Run in the isolated worker, never on the API event loop."""

import base64
import csv
import hashlib
import io
import warnings

from attachments.ocr import LocalOcr, OcrUnavailable, sample_indices

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


def extract(data: dict) -> dict:  # type: ignore[type-arg]
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
    result = {
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

        filters.ZLIB_MAX_OUTPUT_LENGTH = 4 * 1024 * 1024
        reader = PdfReader(io.BytesIO(payload), strict=True)
        if reader.is_encrypted:
            raise ValueError("ENCRYPTED_PDF_UNSUPPORTED")
        count = len(reader.pages)
        if not 0 < count <= 30:
            raise ValueError("PDF_PAGE_LIMIT")
        parts, length, empty = [], 0, []
        for index, page in enumerate(reader.pages):
            part = page.extract_text() or ""
            if not part.strip():
                empty.append(index)
            length += len(part) + 2
            if length > MAX_CHARS:
                raise ValueError("EXTRACTED_TEXT_LIMIT")
            parts.append(part)
        attempted, recognized = [], []
        detail = ""
        if empty:
            try:
                ocr = LocalOcr()
                detail = ocr.notice
                for sample in sample_indices(len(empty)):
                    index = empty[sample]
                    attempted.append(index + 1)
                    part = ocr.read_pdf_page(payload, index + 1)
                    if part:
                        recognized.append(index + 1)
                        parts[index] = part
            except OcrUnavailable as error:
                detail += " " + str(error)
        text = "\n\n".join(f"[Page {index + 1}]\n{part}" for index, part in enumerate(parts) if part.strip())
        if len(text) > MAX_CHARS:
            raise ValueError("EXTRACTED_TEXT_LIMIT")
        result.update(
            text=text,
            units=count,
            status="PARTIAL" if text else "UNSUPPORTED",
            notice=(
                f"Text layer read on {count - len(empty)}/{count} pages. "
                f"Scan OCR attempted on {len(attempted)}/{len(empty)} text-empty pages"
                f" (page numbers: {', '.join(map(str, attempted)) or 'none'}); "
                f"text found on {len(recognized)} OCR page(s). "
                "Unsampled pages and images on pages with a text layer were not OCR-read. "
                "Visual content and layout are not fully read. " + detail
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
        parts, attempted, recognized = [], [], []
        detail = ""
        try:
            ocr = LocalOcr()
            detail = ocr.notice
            with Image.open(io.BytesIO(payload)) as picture:
                for index in sample_indices(count):
                    picture.seek(index)
                    attempted.append(index + 1)
                    text = ocr.read_image(picture)
                    if text:
                        recognized.append(index + 1)
                        parts.append(f"[Frame {index + 1}]\n{text}")
        except OcrUnavailable as error:
            detail += " " + str(error)
        text = "\n\n".join(parts)
        if len(text) > MAX_CHARS:
            raise ValueError("EXTRACTED_TEXT_LIMIT")
        result.update(
            status="PARTIAL" if text else "UNSUPPORTED",
            text=text,
            units=count,
            notice=(
                f"Validated {count} frame(s). Text OCR attempted on {len(attempted)}/{count} frames"
                f" (frame numbers: {', '.join(map(str, attempted)) or 'none'}); "
                f"text found in {len(recognized)} frame(s). "
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
