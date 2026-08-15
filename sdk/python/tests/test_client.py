from __future__ import annotations

import json
import unittest
from collections.abc import Mapping
from uuid import UUID

from freelance_ops_ai.client import AIPlatformClient, AIPlatformError, TransportResponse


class RecordingTransport:
    def __init__(self, response: TransportResponse) -> None:
        self.response = response
        self.request_data: tuple[str, str, Mapping[str, str], bytes | None] | None = None

    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> TransportResponse:
        self.request_data = (method, url, headers, body)
        return self.response


class AIPlatformClientTest(unittest.TestCase):
    def test_start_run_uses_public_spring_boundary_and_trace_context(self) -> None:
        transport = RecordingTransport(TransportResponse(202, b'{"runId":"run-1"}'))
        client = AIPlatformClient("https://api.example.com", lambda: "secret-token", transport)
        workspace_id = UUID("00000000-0000-0000-0000-000000000001")
        project_id = UUID("00000000-0000-0000-0000-000000000002")

        result = client.start_run(workspace_id, project_id, {"requirementText": "hello"})

        self.assertEqual(result, {"runId": "run-1"})
        assert transport.request_data is not None
        method, url, headers, body = transport.request_data
        self.assertEqual(method, "POST")
        self.assertEqual(
            url,
            f"https://api.example.com/api/v2/workspaces/{workspace_id}/projects/{project_id}/agent-runs"
        )
        self.assertEqual(headers["Authorization"], "Bearer secret-token")
        self.assertRegex(headers["traceparent"], r"^00-[0-9a-f]{32}-[0-9a-f]{16}-01$")
        self.assertEqual(json.loads(body or b"{}"), {"requirementText": "hello"})

    def test_problem_response_raises_sanitized_error_code(self) -> None:
        transport = RecordingTransport(TransportResponse(429, b'{"code":"RATE_LIMITED","detail":"private"}'))
        client = AIPlatformClient("https://api.example.com", lambda: "secret-token", transport)

        with self.assertRaisesRegex(AIPlatformError, "status=429 code=RATE_LIMITED"):
            client.get_run(
                UUID("00000000-0000-0000-0000-000000000001"),
                UUID("00000000-0000-0000-0000-000000000003")
            )


if __name__ == "__main__":
    unittest.main()
