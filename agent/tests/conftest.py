"""Legacy provider tests use explicit offline mocks, never live paid APIs."""

import pytest

from platform_budget import offline_provider_test_scope


@pytest.fixture(autouse=True)
def legacy_offline_provider_scope(request):
    # Monetary guard tests exercise the shipped fail-closed default instead.
    production_guard = any(name in str(request.node.fspath) for name in ("platform_budget", "byok_budget"))
    with offline_provider_test_scope(not production_guard):
        yield
