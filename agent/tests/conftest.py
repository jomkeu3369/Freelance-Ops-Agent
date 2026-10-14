"""기존 공급자 테스트에 오프라인 모의 객체를 적용한다. 유료 API는 호출하지 않는다."""

import pytest

from platform_budget import offline_provider_test_scope


@pytest.fixture(autouse=True)
def legacy_offline_provider_scope(request):
    # 금액 제한 테스트는 운영에서 사용하는 기본 거부 정책을 검사한다.
    production_guard = any(name in str(request.node.fspath) for name in ("platform_budget", "byok_budget"))
    with offline_provider_test_scope(not production_guard):
        yield
