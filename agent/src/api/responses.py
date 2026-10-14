"""내부 API의 공통 오류 응답."""

from fastapi.responses import JSONResponse


def problem_response(status: int, title: str, code: str, *, include_type: bool = False) -> JSONResponse:
    content: dict[str, str | int] = {"title": title, "status": status, "code": code}
    if include_type:
        content["type"] = f"urn:freelance-ops:agent:{code.lower()}"
    return JSONResponse(status_code=status, media_type="application/problem+json", content=content)
