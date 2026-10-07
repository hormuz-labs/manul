import io
import json
import unittest

from telemetry.posthog_read import PostHogReader


class PostHogReaderTests(unittest.TestCase):
    def test_only_aggregate_queries_and_private_api_host(self):
        calls = []

        def fetch(request, timeout):
            calls.append((request.full_url, json.loads(request.data), request.get_header("Authorization"), timeout))
            if request.full_url.endswith("/query/"):
                return io.BytesIO(json.dumps({"columns": ["day", "event_count", "active_seconds", "active_installations"],
                                              "results": [["2026-10-07", 2, 135, 1]]}).encode())
            return io.BytesIO(b'{"count": 1}')

        reader = PostHogReader("649766", "test-key", "https://eu.i.posthog.com", fetch=fetch)
        self.assertEqual(reader.daily_usage(), [["2026-10-07", 2, 135, 1]])
        self.assertEqual(reader.operational_logs_7d(), 1)
        self.assertEqual([call[0] for call in calls], ["https://eu.posthog.com/api/projects/649766/query/",
                                                       "https://eu.posthog.com/api/projects/649766/logs/count/"])
        self.assertEqual([call[2] for call in calls], ["Bearer test-key", "Bearer test-key"])
        self.assertIn("GROUP BY day", calls[0][1]["query"]["query"])
        self.assertEqual(calls[1][1]["query"]["serviceNames"], ["manul-telemetry"])

    def test_rejects_unexpected_or_unfinished_results(self):
        for payload in ({"query_status": {"complete": False}},
                        {"columns": ["day", "event_count", "active_seconds", "active_installations"],
                         "results": [["2026-10-07", 2, "invalid", 1]]}):
            reader = PostHogReader("649766", "test-key", "https://us.i.posthog.com",
                                   fetch=lambda *_args, **_kwargs: io.BytesIO(json.dumps(payload).encode()))
            with self.assertRaises(ValueError):
                reader.daily_usage()


if __name__ == "__main__":
    unittest.main()
