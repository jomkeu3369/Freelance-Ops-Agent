from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from pathlib import Path

from similarity_types import Chunk

TOKEN_PATTERN = re.compile(r"[가-힣A-Za-z0-9_]+")


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(text)]


def read_text(path: str | Path) -> str:
    source = Path(path)
    suffix = source.suffix.lower()
    if suffix == ".txt":
        return source.read_text(encoding="utf-8")
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("PDF 처리를 위해 `uv add pypdf`가 필요합니다.") from exc
        pages = [page.extract_text() or "" for page in PdfReader(source).pages]
        return "\n\n".join(pages)
    raise ValueError(f"지원하지 않는 확장자입니다: {suffix}; .txt와 .pdf만 허용합니다.")


def chunk_text(text: str, chunk_size: int = 600, overlap: int = 200) -> list[str]:
    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size:
        raise ValueError("0 <= overlap < chunk_size 조건이어야 합니다.")
    normalized = re.sub(r"\r\n?", "\n", text).strip()
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        hard_end = min(start + chunk_size, len(normalized))
        end = hard_end
        if hard_end < len(normalized):
            candidates = [
                normalized.rfind("\n\n", start, hard_end),
                normalized.rfind(". ", start, hard_end),
                normalized.rfind("다. ", start, hard_end),
                normalized.rfind(" ", start, hard_end),
            ]
            boundary = max(candidates)
            if boundary >= start + chunk_size // 2:
                end = boundary + (1 if normalized[boundary] == " " else 2)
        piece = normalized[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(normalized):
            break
        start = max(start + 1, end - overlap)
    return chunks


def chunks_from_texts(documents: dict[str, str], *, workspace_id: str = "offline-eval", chunk_size: int = 600, overlap: int = 200) -> list[Chunk]:  # noqa: E501
    result: list[Chunk] = []
    seen_hashes: set[str] = set()
    for document_id, text in documents.items():
        pieces = chunk_text(text, chunk_size=chunk_size, overlap=overlap)
        for index, piece in enumerate(pieces):
            content_hash = hashlib.sha256(piece.encode("utf-8")).hexdigest()
            if content_hash in seen_hashes:
                continue
            seen_hashes.add(content_hash)
            result.append(
                Chunk(
                    chunk_id=f"{document_id}:{index}:{content_hash[:10]}",
                    document_id=document_id,
                    text=piece,
                    chunk_index=index,
                    metadata={
                        "workspace_id": workspace_id,
                        "content_hash": content_hash,
                        "total_chunks": len(pieces),
                    }
                )
            )
    if not result:
        raise ValueError("청킹 결과가 없습니다.")
    return result


def chunks_from_paths(paths: Iterable[str | Path], *, workspace_id: str, chunk_size: int = 600, overlap: int = 200) -> list[Chunk]:  # noqa: E501
    documents: dict[str, str] = {}
    for raw_path in paths:
        path = Path(raw_path)
        digest = hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:10]
        documents[f"{path.stem}-{digest}"] = read_text(path)
    return chunks_from_texts(
        documents, workspace_id=workspace_id, chunk_size=chunk_size, overlap=overlap
    )
