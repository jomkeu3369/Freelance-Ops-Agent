"""공개 호출 방식·요청 형식·오류 처리를 대조한다."""

from __future__ import annotations

import json
import unittest
from collections.abc import Mapping
from uuid import UUID

from freelance_ops_ai.client import AIPlatformClient, AIPlatformError, TransportResponse

WORKSPACE_ID = UUID("00000000-0000-0000-0000-000000000001")
PROJECT_ID = UUID("00000000-0000-0000-0000-000000000002")
RUN_ID = UUID("00000000-0000-0000-0000-000000000003")


class RecordingTransport:
    def __init__(self, response: TransportResponse) -> None:
        self.response = response
        self.request_data: tuple[str, str, Mapping[str, str], bytes | None] | None = None
        self.request_count = 0

    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> TransportResponse:
        self.request_data = (method, url, headers, body)
        self.request_count += 1
        return self.response


class AIPlatformClientTest(unittest.TestCase):
    def test_start_run_uses_public_spring_boundary_and_trace_context(self) -> None:
        transport = RecordingTransport(TransportResponse(202, b'{"runId":"run-1"}'))
        client = AIPlatformClient("https://api.example.com", lambda: "secret-token", transport)
        result = client.start_run(WORKSPACE_ID, PROJECT_ID, {"requirementText": "hello"})

        self.assertEqual(result, {"runId": "run-1"})
        assert transport.request_data is not None
        method, url, headers, body = transport.request_data
        self.assertEqual(method, "POST")
        self.assertEqual(
            url,
            f"https://api.example.com/api/v2/workspaces/{WORKSPACE_ID}/projects/{PROJECT_ID}/agent-runs"
        )
        self.assertEqual(headers["Authorization"], "Bearer secret-token")
        self.assertRegex(headers["traceparent"], r"^00-[0-9a-f]{32}-[0-9a-f]{16}-01$")
        self.assertEqual(json.loads(body or b"{}"), {"requirementText": "hello"})

    def test_problem_response_raises_sanitized_error_code(self) -> None:
        transport = RecordingTransport(TransportResponse(429, b'{"code":"RATE_LIMITED","detail":"private"}'))
        client = AIPlatformClient("https://api.example.com", lambda: "secret-token", transport)

        with self.assertRaisesRegex(AIPlatformError, "status=429 code=RATE_LIMITED"):
            client.get_run(WORKSPACE_ID, RUN_ID)

    def test_get_run_preserves_base_path_and_sends_no_body(self) -> None:
        transport = RecordingTransport(TransportResponse(200, b'{"status":"RUNNING"}'))
        client = AIPlatformClient("https://api.example.com/proxy/", lambda: " token ", transport)

        self.assertEqual(client.get_run(WORKSPACE_ID, RUN_ID), {"status": "RUNNING"})
        assert transport.request_data is not None
        method, url, headers, body = transport.request_data
        self.assertEqual(method, "GET")
        self.assertEqual(url, f"https://api.example.com/proxy/api/v2/workspaces/{WORKSPACE_ID}/agent-runs/{RUN_ID}")
        self.assertEqual(headers["Authorization"], "Bearer token")
        self.assertIsNone(body)

    def test_cancel_run_sends_empty_json_object(self) -> None:
        transport = RecordingTransport(TransportResponse(200, b'{"status":"CANCELLED"}'))
        client = AIPlatformClient("https://api.example.com", lambda: "token", transport)

        self.assertEqual(client.cancel_run(WORKSPACE_ID, RUN_ID), {"status": "CANCELLED"})
        assert transport.request_data is not None
        method, url, _, body = transport.request_data
        self.assertEqual(method, "POST")
        self.assertEqual(url, f"https://api.example.com/api/v2/workspaces/{WORKSPACE_ID}/agent-runs/{RUN_ID}/cancel")
        self.assertEqual(body, b"{}")

    def test_token_provider_is_read_for_each_call(self) -> None:
        transport = RecordingTransport(TransportResponse(200, b"{}"))
        tokens = iter(["first-token", "refreshed-token"])
        client = AIPlatformClient("https://api.example.com", lambda: next(tokens), transport)

        for token in ("first-token", "refreshed-token"):
            client.get_run(WORKSPACE_ID, RUN_ID)
            assert transport.request_data is not None
            self.assertEqual(transport.request_data[2]["Authorization"], f"Bearer {token}")
        self.assertEqual(transport.request_count, 2)

    def test_empty_token_is_rejected_before_transport(self) -> None:
        transport = RecordingTransport(TransportResponse(200, b"{}"))
        client = AIPlatformClient("https://api.example.com", lambda: " \n", transport)

        with self.assertRaises(ValueError):
            client.get_run(WORKSPACE_ID, RUN_ID)
        self.assertEqual(transport.request_count, 0)

    def test_malformed_success_response_raises_sdk_error_without_body(self) -> None:
        for body in (b"<html>private-response</html>", b"\xffprivate-response"):
            with self.subTest(body=body):
                transport = RecordingTransport(TransportResponse(200, body))
                client = AIPlatformClient("https://api.example.com", lambda: "token", transport)
                with self.assertRaises(AIPlatformError) as caught:
                    client.get_run(WORKSPACE_ID, RUN_ID)
                self.assertEqual((caught.exception.status, caught.exception.code), (502, "INVALID_RESPONSE"))
                self.assertNotIn("private-response", str(caught.exception))
                self.assertIsNone(caught.exception.__context__)

    def test_malformed_http_error_preserves_status_without_retrying_start(self) -> None:
        for status in (401, 429, 503):
            for body in (b"<html>private-response</html>", b"\xffprivate-response", b"[]", b""):
                with self.subTest(status=status, body=body):
                    transport = RecordingTransport(TransportResponse(status, body))
                    client = AIPlatformClient("https://api.example.com", lambda: "token", transport)
                    with self.assertRaises(AIPlatformError) as caught:
                        client.start_run(WORKSPACE_ID, PROJECT_ID, {"requirementText": "문의"})
                    self.assertEqual((caught.exception.status, caught.exception.code), (status, "UNKNOWN"))
                    self.assertNotIn("private-response", str(caught.exception))
                    self.assertIsNone(caught.exception.__context__)
                    self.assertEqual(transport.request_count, 1)

    def test_non_object_success_response_remains_invalid(self) -> None:
        for body in (b"[]", b"null", b'"text"'):
            with self.subTest(body=body):
                client = AIPlatformClient(
                    "https://api.example.com", lambda: "token", RecordingTransport(TransportResponse(200, body))
                )
                with self.assertRaises(AIPlatformError) as caught:
                    client.get_run(WORKSPACE_ID, RUN_ID)
                self.assertEqual((caught.exception.status, caught.exception.code), (502, "INVALID_RESPONSE"))

    def test_empty_success_body_remains_an_empty_object(self) -> None:
        client = AIPlatformClient(
            "https://api.example.com", lambda: "token", RecordingTransport(TransportResponse(204, b""))
        )
        self.assertEqual(client.cancel_run(WORKSPACE_ID, RUN_ID), {})

    def test_legacy_import_paths_keep_the_same_classes(self) -> None:
        import freelance_ops_ai
        import freelance_ops_ai.client as legacy
        from freelance_ops_ai import errors, transport

        self.assertIs(freelance_ops_ai.AIPlatformClient, legacy.AIPlatformClient)
        self.assertIs(freelance_ops_ai.AIPlatformError, errors.AIPlatformError)
        self.assertIs(legacy.AIPlatformError, errors.AIPlatformError)
        for name in ("Transport", "TransportResponse", "UrlLibTransport"):
            self.assertIs(getattr(legacy, name), getattr(transport, name))
        self.assertEqual(freelance_ops_ai.__all__, ["AIPlatformClient", "AIPlatformError"])

    def test_non_http_base_url_is_rejected(self) -> None:
        for base_url in ("", "ftp://api.example.com", "api.example.com"):
            with self.subTest(base_url=base_url), self.assertRaises(ValueError):
                AIPlatformClient(base_url, lambda: "token")


if __name__ == "__main__":
    unittest.main()
