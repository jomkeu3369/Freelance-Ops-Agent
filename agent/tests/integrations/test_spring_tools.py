from uuid import uuid4

import httpx
import pytest

from contracts import KnowledgeSearchRequest, QuoteCalculationItem, QuoteCalculationRequest, RequirementDraft
from integrations import SpringToolClient, SpringToolError
from runtime import ExecutionAuthorization


async def test_project_context_uses_transient_delegation_headers() -> None:
    run_id = uuid4()
    project_id = uuid4()
    workspace_id = uuid4()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer short-lived-token"
        assert request.headers["X-Run-Id"] == str(run_id)
        return httpx.Response(
            200,
            json={
                "projectId": str(project_id),
                "workspaceId": str(workspace_id),
                "title": "프로젝트",
                "requirementText": "요구사항",
                "currency": "KRW",
            },
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://backend:8080",
    ) as http_client:
        client = SpringToolClient("http://backend:8080", client=http_client)
        context = await client.get_project_context(
            "short-lived-token",
            run_id=run_id,
            project_id=project_id,
        )

    assert context.workspace_id == workspace_id
    assert "short-lived-token" not in repr(ExecutionAuthorization("short-lived-token"))


async def test_project_context_maps_permission_failure_without_response_body_leak() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(403, text="secret details")),
        base_url="http://backend:8080",
    ) as http_client:
        client = SpringToolClient("http://backend:8080", client=http_client)
        with pytest.raises(SpringToolError, match="SPRING_TOOL_FORBIDDEN"):
            await client.get_project_context(
                "token",
                run_id=uuid4(),
                project_id=uuid4(),
            )


async def test_all_structured_spring_tool_contracts() -> None:
    run_id = uuid4()
    project_id = uuid4()
    item_id = uuid4()
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        assert request.headers["X-Run-Id"] == str(run_id)
        if request.url.path.endswith("/domain-packs/software"):
            return httpx.Response(
                200,
                json={
                    "code": "software",
                    "version": "2026-08",
                    "jurisdictionCode": "KR",
                    "professionCode": "SOFTWARE_DEVELOPER",
                    "scope": "software development",
                    "requiredFields": ["features"],
                    "sourceReferences": [{"title": "source", "url": "https://example.com"}],
                    "effectiveFrom": "2026-08-14",
                    "effectiveUntil": None,
                    "questionTemplates": ["사용자 유형은?"],
                },
            )
        if request.url.path.endswith("/requirements/validate"):
            return httpx.Response(200, json={"valid": True, "errors": [], "warnings": []})
        if request.url.path.endswith("/quotes/calculate"):
            return httpx.Response(
                200,
                json={
                    "currency": "KRW",
                    "subtotal": 200000,
                    "discountAmount": 20000,
                    "taxAmount": 18000,
                    "total": 198000,
                    "formulaVersion": "v1",
                },
            )
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://backend:8080") as http_client:
        client = SpringToolClient("http://backend:8080", client=http_client)
        pack = await client.get_domain_pack("token", run_id=run_id, domain_code="software")
        validation = await client.validate_requirements(
            "token",
            run_id=run_id,
            draft=RequirementDraft(
                project_id=project_id,
                summary="summary",
                features=["feature"],
                constraints=[],
                assumptions=[],
                open_questions=[],
            ),
        )
        quote = await client.calculate_quote(
            "token",
            run_id=run_id,
            request=QuoteCalculationRequest(
                currency="KRW",
                tax_rate=0.1,
                discount_rate=0.1,
                items=[QuoteCalculationItem(item_id=item_id, quantity=2, unit_price=100000)],
            ),
        )

    assert pack.version == "2026-08"
    assert validation.valid
    assert quote.total == 198000
    assert seen_paths == [
        "/internal/v1/domain-packs/software",
        "/internal/v1/requirements/validate",
        "/internal/v1/quotes/calculate",
    ]


async def test_read_tool_retries_transient_gateway_failure() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503)
        return httpx.Response(
            200,
            json={
                "code": "software",
                "version": "v1",
                "jurisdictionCode": "KR",
                "professionCode": "SOFTWARE_DEVELOPER",
                "scope": "scope",
                "requiredFields": [],
                "questionTemplates": [],
                "sourceReferences": [],
                "effectiveFrom": "2026-08-14",
                "effectiveUntil": None,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://backend:8080") as http_client:
        client = SpringToolClient("http://backend:8080", client=http_client)
        await client.get_domain_pack("token", run_id=uuid4(), domain_code="software")

    assert calls == 2


async def test_knowledge_search_validates_grounded_result_contract() -> None:
    run_id = uuid4()
    chunk_id = uuid4()
    document_id = uuid4()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/internal/v1/knowledge/search"
        return httpx.Response(
            200,
            json=[{
                "chunkId": str(chunk_id),
                "documentId": str(document_id),
                "documentTitle": "계약 정책",
                "sourceType": "POLICY",
                "sourceUri": "https://example.com/policy",
                "sourceVersion": "2026-08",
                "jurisdiction": "KR",
                "effectiveFrom": "2026-08-01",
                "effectiveUntil": None,
                "content": "계약금은 착수 전에 지급한다.",
                "rrfScore": 0.03,
                "keywordRank": 1,
                "vectorRank": 2,
            }],
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://backend:8080") as http_client:
        client = SpringToolClient("http://backend:8080", client=http_client)
        results = await client.search_knowledge(
            "token",
            run_id=run_id,
            request=KnowledgeSearchRequest(query="계약금", limit=5),
        )

    assert results[0].chunk_id == chunk_id
    assert results[0].jurisdiction == "KR"


async def test_read_tool_honors_run_attempt_limit() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        del request
        calls += 1
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://backend:8080") as http_client:
        client = SpringToolClient("http://backend:8080", client=http_client)
        with pytest.raises(SpringToolError, match="SPRING_TOOL_UNAVAILABLE"):
            await client.get_domain_pack(
                "token",
                run_id=uuid4(),
                domain_code="software",
                max_attempts=1,
            )

    assert calls == 1
