"""표준 입출력으로만 통신하는 내부 작업자 진입점. 실패 시 원문을 출력하지 않는다."""

import json
import os
import sys

if sys.platform != "win32":
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))

# -I로 외부 PYTHONPATH를 차단하고 신뢰하는 소스 경로만 추가한다.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from attachments.reader import extract

try:
    body = sys.stdin.buffer.read(2_800_001)
    if len(body) > 2_800_000:
        raise ValueError("FILE_SIZE_LIMIT")
    print(json.dumps(extract(json.loads(body)), ensure_ascii=True))
except Exception as error:
    safe_codes = {
        "INVALID_FILENAME",
        "UNSUPPORTED_TYPE_OR_MIME",
        "INVALID_BASE64",
        "FILE_SIZE_LIMIT",
        "EXTRACTED_TEXT_LIMIT",
        "NOT_PLAIN_TEXT",
        "FORMAT_MISMATCH",
        "CSV_DELIMITER_REQUIRED",
        "CSV_DIMENSION_LIMIT",
        "ENCRYPTED_PDF_UNSUPPORTED",
        "PDF_PAGE_LIMIT",
        "IMAGE_FRAME_OR_PIXEL_LIMIT",
        "TEXT_ENCODING_UNSUPPORTED",
        "PARSER_RESOURCE_LIMIT",
        "OCR_OPTIONS_UNSUPPORTED",
    }
    code = str(error) if isinstance(error, ValueError) and str(error) in safe_codes else "UNREADABLE_FILE"
    print(json.dumps({"error": code}))
