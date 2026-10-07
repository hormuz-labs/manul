"""Optional server-side PostHog Product Analytics and OTLP Logs export.

No PostHog code or credential ships in Manul. Only accepted, opt-in usage events
are forwarded; operational logs contain fixed categories, never request bodies.
"""
import json
import urllib.request
from datetime import datetime, timezone
from time import time_ns


class PostHogExporter:
    def __init__(self, project_token, host="https://us.i.posthog.com", fetch=None):
        if not host.startswith("https://") or host.endswith("/"):
            raise ValueError("POSTHOG_HOST must be an HTTPS origin without a trailing slash")
        self.project_token = project_token
        self.host = host
        self.fetch = fetch or urllib.request.urlopen

    def post(self, path, payload, *, auth=False):
        headers = {"Content-Type": "application/json", "User-Agent": "Manul-telemetry/1"}
        if auth:
            headers["Authorization"] = f"Bearer {self.project_token}"
        request = urllib.request.Request(self.host + path, data=json.dumps(payload).encode(), headers=headers)
        with self.fetch(request, timeout=8) as response:
            if not 200 <= response.status < 300:
                raise ValueError(f"PostHog returned HTTP {response.status}")

    def active_time(self, event_id, installation_id, seconds, received_at):
        self.post("/capture/", {
            "api_key": self.project_token,
            "uuid": event_id,
            "event": "manul active time",
            "distinct_id": installation_id,
            "timestamp": datetime.fromtimestamp(received_at, timezone.utc).isoformat(),
            "properties": {"distinct_id": installation_id, "active_seconds": seconds,
                           "$process_person_profile": False, "$geoip_disable": True},
        })

    def operational_log(self, message, *, severity="ERROR"):
        """Send only fixed, non-user-derived messages to PostHog Logs (OTLP/JSON)."""
        self.post("/i/v1/logs", {
            "resourceLogs": [{
                "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "manul-telemetry"}}]},
                "scopeLogs": [{"scope": {"name": "manul-telemetry"}, "logRecords": [{
                    "timeUnixNano": str(time_ns()), "severityText": severity,
                    "severityNumber": 17 if severity == "ERROR" else 13,
                    "body": {"stringValue": message},
                }]}],
            }],
        }, auth=True)
