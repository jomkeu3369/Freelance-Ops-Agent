"""Bounded, local specialist task dispatch; this is not the external A2A protocol."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

from contracts import DepartmentName

from .runs import ExecutionEvent, publish_progress


async def delegate_internal_task[T](
    run_id: UUID,
    department: DepartmentName,
    work: Callable[[], Awaitable[T]],
    summarize: Callable[[T], str],
) -> T:
    """Run real department work and publish its lifecycle while it is executing.

    The caller owns route selection, budget, delegated tool scope and result validation.
    Task IDs give the UI a stable handle without claiming A2A interoperability.
    """
    task_id = str(uuid4())
    identity: dict[str, object] = {"taskId": task_id, "department": department.value}
    await publish_progress(ExecutionEvent("task.delegated", identity))
    try:
        result = await work()
        summary = summarize(result)
    except Exception as error:
        await publish_progress(ExecutionEvent("task.failed", {**identity, "errorType": type(error).__name__}))
        raise
    await publish_progress(ExecutionEvent("task.completed", {**identity, "summary": summary[:10000]}))
    return result
