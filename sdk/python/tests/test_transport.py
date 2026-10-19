"""실제 네트워크 호출 없이 urllib 요청과 응답 자원 해제를 확인한다."""

import unittest
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.response import addinfourl

from freelance_ops_ai.transport import UrlLibTransport


class UrlLibTransportTest(unittest.TestCase):
    def test_request_preserves_http_fields_timeout_and_closes_response(self) -> None:
        body = BytesIO(b'{"runId":"run-1"}')
        url = "https://api.example.com/api/v2/workspaces/workspace/agent-runs/run"
        response = addinfourl(body, {}, url, 202)
        with patch("freelance_ops_ai.transport.urllib.request.urlopen", return_value=response) as open_request:
            result = UrlLibTransport().request(
                "POST", url, {"Authorization": "Bearer test-token", "Content-Type": "application/json"}, b"{}"
            )
        self.assertEqual((result.status, result.body), (202, b'{"runId":"run-1"}'))
        request = open_request.call_args.args[0]
        self.assertEqual(request.full_url, url)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.data, b"{}")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(open_request.call_args.kwargs, {"timeout": 30})
        self.assertTrue(body.closed)

    def test_http_error_returns_status_and_body_and_closes_response(self) -> None:
        body = BytesIO(b'{"code":"RATE_LIMITED"}')
        error = HTTPError("https://api.example.com", 429, "limited", {}, body)
        with patch("freelance_ops_ai.transport.urllib.request.urlopen", side_effect=error):
            result = UrlLibTransport().request("GET", "https://api.example.com", {}, None)
        self.assertEqual((result.status, result.body), (429, b'{"code":"RATE_LIMITED"}'))
        self.assertTrue(body.closed)

    def test_network_error_is_propagated_without_retry(self) -> None:
        error = URLError("offline test")
        with patch("freelance_ops_ai.transport.urllib.request.urlopen", side_effect=error) as open_request:
            with self.assertRaises(URLError) as caught:
                UrlLibTransport().request("POST", "https://api.example.com", {}, b"{}")
        self.assertIs(caught.exception, error)
        self.assertEqual(open_request.call_count, 1)


if __name__ == "__main__":
    unittest.main()
