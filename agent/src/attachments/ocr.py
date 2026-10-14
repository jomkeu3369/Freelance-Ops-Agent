"""로컬 OCR 도구로 텍스트를 추출한다. 도구에는 사용자 파일명 대신 바이트를 전달한다.
POSIX 작업자에서만 실행하며 프로세스 그룹과 자원 한도를 하위 프로세스에도 적용한다. 원본과
OCR 이미지는 저장하지 않는다.
"""

from __future__ import annotations

import io
import os
import selectors
import shutil
import subprocess
import time
from collections.abc import Sequence

from PIL import Image, ImageOps

MAX_OCR_UNITS = 3
MAX_OCR_EDGE = 2000
MAX_OCR_SECONDS = 8.0
MAX_COMMAND_SECONDS = 3.0
MAX_OCR_CHARS = 40_000
OCR_LANGUAGES = {"mixed": "eng+kor", "ko": "kor", "en": "eng"}
OCR_LAYOUTS = {"general": "3", "singleblock": "6"}


class OcrUnavailable(Exception):
    """도구 진단 정보나 원문이 포함되지 않은 고정 안내 메시지."""

    def __init__(self, message: str, reason: str = "TOOL_FAILED") -> None:
        super().__init__(message)
        self.reason = reason


def sample_indices(count: int) -> list[int]:
    """첫 번째, 가운데, 마지막 항목을 선택한다. 원본 인덱스는 0부터 시작한다."""
    if count <= MAX_OCR_UNITS:
        return list(range(count))
    return [0, (count - 1) // 2, count - 1]


def run_native(arguments: Sequence[str], payload: bytes, *, deadline: float, max_output: int) -> bytes:
    """셸과 파일을 사용하지 않고 크기가 제한된 파이프를 읽는다. 비밀 환경 변수와 무제한
    communicate 호출을 사용하지 않는다.
    """
    if os.name != "posix":
        raise OcrUnavailable("Local OCR requires the Linux reader environment.", "TOOL_UNAVAILABLE")
    expires = min(deadline, time.monotonic() + MAX_COMMAND_SECONDS)
    if expires <= time.monotonic():
        raise OcrUnavailable("The local OCR time budget was reached.", "BUDGET_EXHAUSTED")
    environment = {"PATH": os.environ.get("PATH", ""), "OMP_THREAD_LIMIT": "1", "LC_ALL": "C"}
    try:
        with subprocess.Popen(
            list(arguments),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=environment,
            close_fds=True
        ) as process:
            assert process.stdin is not None and process.stdout is not None
            output = bytearray()
            offset = 0
            try:
                with selectors.DefaultSelector() as selector:
                    os.set_blocking(process.stdin.fileno(), False)
                    os.set_blocking(process.stdout.fileno(), False)
                    if payload:
                        selector.register(process.stdin, selectors.EVENT_WRITE)
                    else:
                        process.stdin.close()
                    selector.register(process.stdout, selectors.EVENT_READ)
                    while selector.get_map():
                        remaining = expires - time.monotonic()
                        if remaining <= 0:
                            raise OcrUnavailable("The local OCR time budget was reached.", "BUDGET_EXHAUSTED")
                        for key, event in selector.select(remaining):
                            if event == selectors.EVENT_WRITE:
                                try:
                                    offset += os.write(key.fd, payload[offset : offset + 65_536])
                                except BrokenPipeError:
                                    offset = len(payload)
                                if offset == len(payload):
                                    selector.unregister(process.stdin)
                                    process.stdin.close()
                            else:
                                chunk = os.read(key.fd, min(65_536, max_output - len(output) + 1))
                                if not chunk:
                                    selector.unregister(process.stdout)
                                output.extend(chunk)
                                if len(output) > max_output:
                                    raise ValueError("PARSER_RESOURCE_LIMIT")
                remaining = expires - time.monotonic()
                if remaining <= 0:
                    raise OcrUnavailable("The local OCR time budget was reached.", "BUDGET_EXHAUSTED")
                if process.wait(timeout=remaining) != 0:
                    raise OcrUnavailable("A local OCR tool could not read the content.")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
            return bytes(output)
    except subprocess.TimeoutExpired as error:
        raise OcrUnavailable("The local OCR time budget was reached.", "BUDGET_EXHAUSTED") from error
    except OSError as error:
        raise OcrUnavailable("A required local OCR tool is unavailable.", "TOOL_UNAVAILABLE") from error


class LocalOcr:
    def __init__(self, language: str = "mixed", layout: str = "general") -> None:
        if language not in OCR_LANGUAGES or layout not in OCR_LAYOUTS:
            raise ValueError("OCR_OPTIONS_UNSUPPORTED")
        self.deadline = time.monotonic() + MAX_OCR_SECONDS
        self.languages = OCR_LANGUAGES[language]
        self.psm = OCR_LAYOUTS[layout]
        self.executable = shutil.which("tesseract") if os.name == "posix" else None
        if self.executable is None:
            raise OcrUnavailable(
                "Local OCR is unavailable; install Tesseract in the Linux reader environment.", "TOOL_UNAVAILABLE"
            )
        installed = (
            run_native([self.executable, "--list-langs"], b"", deadline=self.deadline, max_output=8192)
            .decode("utf-8", errors="replace")
            .splitlines()
        )
        if any(pack not in installed for pack in self.languages.split("+")):
            raise OcrUnavailable("The requested local OCR language pack is unavailable.", "LANGUAGE_UNAVAILABLE")

    def read_image(self, picture: Image.Image) -> str:
        assert self.executable is not None
        with ImageOps.exif_transpose(picture) as oriented:
            oriented.thumbnail((MAX_OCR_EDGE, MAX_OCR_EDGE))
            with oriented.convert("RGBA") as rgba, Image.new("RGBA", oriented.size, "white") as background:
                background.alpha_composite(rgba)
                with background.convert("RGB") as rgb:
                    output = io.BytesIO()
                    rgb.save(output, format="PNG")
        text = (
            run_native(
                [self.executable, "stdin", "stdout", "-l", self.languages, "--psm", self.psm],
                output.getvalue(),
                deadline=self.deadline,
                max_output=MAX_OCR_CHARS * 4
            )
            .decode("utf-8", errors="strict")
            .strip()
        )
        if len(text) > MAX_OCR_CHARS:
            raise ValueError("EXTRACTED_TEXT_LIMIT")
        return text

    def read_pdf_page(self, payload: bytes, page: int) -> str:
        renderer = shutil.which("pdftoppm")
        if renderer is None:
            raise OcrUnavailable(
                "Scan OCR is unavailable; install Poppler in the Linux reader environment.", "TOOL_UNAVAILABLE"
            )
        png = run_native(
            [renderer, "-f", str(page), "-l", str(page), "-singlefile", "-scale-to", str(MAX_OCR_EDGE), "-png", "-"],
            payload,
            deadline=self.deadline,
            max_output=16 * 1024 * 1024
        )
        with Image.open(io.BytesIO(png)) as picture:
            if picture.format != "PNG" or picture.width * picture.height > MAX_OCR_EDGE**2:
                raise ValueError("PARSER_RESOURCE_LIMIT")
            picture.load()
            return self.read_image(picture)

    @property
    def notice(self) -> str:
        return (
            f"Free local OCR languages: {self.languages}; PSM {self.psm}; "
            f"images scaled to at most {MAX_OCR_EDGE}px per edge. "
            "OCR may miss or misread text; verify the preview. "
            "Objects, charts, handwriting, layout and animation meaning are not understood."
        )
