"""실행 중인 작업의 진행 이벤트 전달."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from .run_contracts import ExecutionEvent

_progress_publisher: ContextVar[Callable[[ExecutionEvent], Awaitable[None]] | None] = ContextVar(
    "agent_run_progress_publisher", default=None
)


async def publish_progress(event: ExecutionEvent) -> None:
    """다음 부서가 시작되기 전에 현재 작업의 진행 이벤트를 저장한다."""
    publisher = _progress_publisher.get()
    if publisher is not None:
        await publisher(event)


@contextmanager
def progress_scope(publisher: Callable[[ExecutionEvent], Awaitable[None]]) -> Iterator[None]:
    """현재 실행의 전달 대상을 설정하고 종료 시 이전 대상으로 복원한다."""
    token = _progress_publisher.set(publisher)
    try:
        yield
    finally:
        _progress_publisher.reset(token)
