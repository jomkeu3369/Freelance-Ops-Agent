import asyncio

from infrastructure.database import PgVectorConnectionManager


class DatabaseReadinessProbe:
    """Bound HTTP waiting and keep at most one database check in flight."""

    def __init__(self, timeout_seconds: float = 1.0) -> None:
        self._timeout_seconds = timeout_seconds
        self._task: asyncio.Task[bool] | None = None

    async def check(self, database: PgVectorConnectionManager) -> bool:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._check_database(database))
        task = self._task
        # Driver cancellation may itself block during a network outage. Do not
        # cancel on HTTP timeout or create more checks while this one is pending.
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
            # Never expose connection strings or driver errors in health output.
            return False
