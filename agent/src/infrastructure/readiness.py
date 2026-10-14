import asyncio

from infrastructure.database import PgVectorConnectionManager


class DatabaseReadinessProbe:
    """HTTP 대기 시간을 제한하고 진행 중인 데이터베이스 점검 하나를 공유한다."""

    def __init__(self, timeout_seconds: float = 1.0) -> None:
        self._timeout_seconds = timeout_seconds
        self._task: asyncio.Task[bool] | None = None

    async def check(self, database: PgVectorConnectionManager) -> bool:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._check_database(database))
        task = self._task
        # 네트워크 장애 중에는 드라이버의 취소도 멈출 수 있다.
        # HTTP 대기 시간 초과로 점검을 취소하거나 대기 중인 점검을 추가하지 않는다.
        done, _ = await asyncio.wait({task}, timeout=self._timeout_seconds)
        return task.result() if done and not task.cancelled() else False

    async def close(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            await asyncio.wait({self._task}, timeout=self._timeout_seconds)

    @staticmethod
    async def _check_database(database: PgVectorConnectionManager) -> bool:
        try:
            await database.health()
            return True
        except Exception:
            # 상태 응답에는 연결 문자열과 드라이버 오류를 노출하지 않는다.
            return False
