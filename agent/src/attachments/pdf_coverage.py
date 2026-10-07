"""Bounded raster placement inspection; never decode or save embedded images.

A painted raster covering >=25% of the media box (including tiled images) is a
scan candidate. This is a conservative heuristic, not visual understanding.
Small images and annotation appearances can still contain unread text.
"""

import math
import re
from typing import Any

from pypdf.errors import PdfReadError
from pypdf.generic import ContentStream, DecodedStreamObject

MAX_STREAM_BYTES = 262_144
MAX_INSPECTION_BYTES = 1_048_576
MAX_OPERATIONS = 5000
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
    """NONE/SMALL/LARGE/UNKNOWN, including inline images and nested painted Forms."""
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

    try:
        inspect(page.get_contents(), page.get("/Resources", {}), IDENTITY, set(), 0)
    except (InspectionLimit, PdfReadError, ValueError, TypeError, KeyError, RecursionError):
        return "UNKNOWN"
    return "LARGE" if total_area / page_area >= SCAN_AREA_RATIO else "SMALL" if images else "NONE"


def additional_ocr(native: str, recognized: str) -> str:
    """Remove only an exact native-text prefix, once; preserve repeated identifiers.

    Whitespace may differ between the native and OCR copies. No fuzzy match, case
    folding, numeric-only deletion, or global repeated-line removal is performed.
    """
    tokens = re.findall(r"\S+", native)
    matches = list(re.finditer(r"\S+", recognized))
    if tokens and any(char.isalpha() for char in native) and tokens == [m.group() for m in matches[: len(tokens)]]:
        return recognized[matches[len(tokens) - 1].end() :].strip()
    return recognized
