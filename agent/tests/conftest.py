"""Legacy provider tests use explicit offline mocks, never live paid APIs."""

import pytest

from platform_budget import offline_provider_test_scope


@pytest.fixture(autouse=True)
def legacy_offline_provider_scope(request):
    # Monetary guard tests exercise the shipped fail-closed default instead.
    with offline_provider_test_scope("platform_budget" not in str(request.node.fspath)):
        yield
