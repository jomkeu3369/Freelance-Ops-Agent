"""Run in the isolated worker, never on the API event loop."""

import base64
import csv
import hashlib
import io
import warnings

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
        parts, length, empty = [], 0, 0
        for page in reader.pages:
            part = page.extract_text() or ""
            empty += not bool(part.strip())
            length += len(part) + 2
            if length > MAX_CHARS:
                raise ValueError("EXTRACTED_TEXT_LIMIT")
            parts.append(part)
        result.update(
            text="\n\n".join(parts),
            units=count,
            status="UNSUPPORTED" if empty == count else "PARTIAL",
            notice=(f"Text layer only; {empty}/{count} pages have no text. "
                    "Images, scans and layout were not read. OCR is unavailable. "
                    "Supply TXT/CSV for missing content."),
        )  # noqa: E501
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
        result.update(
            status="UNSUPPORTED",
            units=count,
            notice=(f"Validated {count} frame(s). Image/GIF content was not read: "
                    "OCR and visual understanding are unavailable. Supply a text description."),
        )  # noqa: E501
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
