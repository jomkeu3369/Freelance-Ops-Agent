"""내부 부서 작업을 제한된 범위에서 위임한다. 외부 A2A 프로토콜과는 별개다."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

from contracts import DepartmentName

from .run_contracts import ExecutionEvent
from .run_progress import publish_progress


async def delegate_internal_task[T](run_id: UUID, department: DepartmentName, work: Callable[[], Awaitable[T]], summarize: Callable[[T], str]) -> T:  # noqa: E501
    """부서 작업을 실행하고 진행 상태를 공개한다. 경로 선택, 예산, 도구 권한과 결과 검증은
    호출자가 관리한다. 작업 ID는 UI에서 진행 상태를 연결하는 식별자로 사용한다.
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
