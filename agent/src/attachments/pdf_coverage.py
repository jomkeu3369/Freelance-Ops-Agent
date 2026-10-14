"""PDF에서 그려진 이미지의 위치와 면적을 검사한다. 페이지 면적의 25% 이상을 차지하는
이미지나 타일 조합을 스캔 후보로 본다. 작은 이미지와 주석에도 읽지 못한 텍스트가 있을 수
있다. 스트림 크기는 압축 해제 후, 연산자 수는 pypdf 파싱 후 검사하며 작업자의
CPU·메모리·요청 한도를 최종 경계로 사용한다. 내장 이미지를 디코딩하거나 저장하지 않는다.
"""

import math
import re
from typing import Any

from pypdf.errors import PdfReadError
from pypdf.generic import ContentStream, DecodedStreamObject

MAX_STREAM_BYTES = 262_144
MAX_INSPECTION_BYTES = 1_048_576
MAX_OPERATIONS = 5000
MAX_PREFLIGHT_TOKENS = 20_000
MAX_FORMS = 64
MAX_DEPTH = 8
SCAN_AREA_RATIO = 0.25
IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


class InspectionLimit(Exception):
    pass


def multiply(current: tuple[float, ...], local: tuple[float, ...]) -> tuple[float, ...]:
    a, b, c, d, e, f = current
    g, h, i, j, k, offset_y = local
    return (
        a * g + c * h,
        b * g + d * h,
        a * i + c * j,
        b * i + d * j,
        a * k + c * offset_y + e,
        b * k + d * offset_y + f,
    )


def raster_kind(page: Any) -> str:
    """인라인 이미지와 중첩된 Form을 포함해 이미지 면적을 NONE, SMALL,
    LARGE, UNKNOWN으로 분류한다.
    """
    try:
        return _raster_kind(page)
    except (
        InspectionLimit,
        PdfReadError,
        ValueError,
        TypeError,
        KeyError,
        IndexError,
        AttributeError,
        OverflowError,
        RecursionError,
    ):
        # 이미지 좌표나 리소스가 손상돼도 읽을 수 있는 기존 텍스트는 보존한다.
        # 자원 고갈과 시스템 오류는 작업자 경계에서 처리하도록 전달한다.
        return "UNKNOWN"


def _raster_kind(page: Any) -> str:
    box = tuple(float(value) for value in page.mediabox)
    page_area = (box[2] - box[0]) * (box[3] - box[1])
    if not math.isfinite(page_area) or page_area <= 0:
        return "UNKNOWN"
    total_area, images, byte_count, operations, forms = 0.0, 0, 0, 0, 0

    def image(matrix: tuple[float, ...]) -> None:
        nonlocal total_area, images
        a, b, c, d, e, f = matrix
        points = [(e, f), (a + e, b + f), (c + e, d + f), (a + c + e, b + d + f)]
        if not all(math.isfinite(value) for point in points for value in point):
            raise InspectionLimit
        width = max(0.0, min(box[2], max(p[0] for p in points)) - max(box[0], min(p[0] for p in points)))
        height = max(0.0, min(box[3], max(p[1] for p in points)) - max(box[1], min(p[1] for p in points)))
        total_area += width * height
        images += 1

    def inspect(stream: Any, resources: Any, matrix: tuple[float, ...], active: set[int], depth: int) -> None:
        nonlocal byte_count, operations, forms
        if stream is None:
            return
        if depth > MAX_DEPTH:
            raise InspectionLimit
        content = stream.get_data()
        byte_count += len(content)
        if len(content) > MAX_STREAM_BYTES or byte_count > MAX_INSPECTION_BYTES:
            raise InspectionLimit
        # 압축 해제된 스트림을 공백으로 나눠 연산자가 과도하게 많은 입력의 재파싱을 막는다.
        # PDF 토큰 분석기는 아니므로 정상 텍스트나 인라인 데이터도 거부할 수 있다.
        # 압축 해제 자체의 비용은 작업자의 자원 한도로 제한한다.
        for token_count, _ in enumerate(re.finditer(rb"\S+", content), 1):
            if token_count > MAX_PREFLIGHT_TOKENS:
                raise InspectionLimit
        bounded = DecodedStreamObject()
        bounded.set_data(content)
        parsed = ContentStream(bounded, page.pdf)
        stack = []
        for operands, operator in parsed.operations:
            operations += 1
            if operations > MAX_OPERATIONS:
                raise InspectionLimit
            if operator == b"q":
                stack.append(matrix)
                if len(stack) > MAX_OPERATIONS:
                    raise InspectionLimit
            elif operator == b"Q":
                if not stack:
                    raise InspectionLimit
                matrix = stack.pop()
            elif operator == b"cm":
                if len(operands) != 6:
                    raise InspectionLimit
                matrix = multiply(matrix, tuple(float(value) for value in operands))
            elif operator == b"INLINE IMAGE":
                image(matrix)
            elif operator == b"Do":
                if len(operands) != 1:
                    raise InspectionLimit
                objects = resources.get("/XObject", {})
                obj = objects[operands[0]].get_object()
                if obj.get("/Subtype") == "/Image":
                    image(matrix)
                elif obj.get("/Subtype") == "/Form":
                    forms += 1
                    identity = id(obj)
                    if forms > MAX_FORMS or identity in active:
                        raise InspectionLimit
                    local = tuple(float(value) for value in obj.get("/Matrix", IDENTITY))
                    if len(local) != 6:
                        raise InspectionLimit
                    inspect(
                        obj, obj.get("/Resources", resources), multiply(matrix, local), active | {identity}, depth + 1
                    )

    inspect(page.get_contents(), page.get("/Resources", {}), IDENTITY, set(), 0)
    return "LARGE" if total_area / page_area >= SCAN_AREA_RATIO else "SMALL" if images else "NONE"


def additional_ocr(native: str, recognized: str) -> str:
    """OCR 텍스트의 시작이 기존 텍스트와 일치할 때 한 번만 제거한다. 공백 차이는 허용하되
    유사 문자열 비교, 대소문자 통합, 숫자 삭제, 반복 줄 제거는 하지 않는다.
    """
    tokens = re.findall(r"\S+", native)
    matches = list(re.finditer(r"\S+", recognized))
    if tokens and any(char.isalpha() for char in native) and tokens == [m.group() for m in matches[: len(tokens)]]:
        return recognized[matches[len(tokens) - 1].end() :].strip()
    return recognized
