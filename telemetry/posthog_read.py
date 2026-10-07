"""Read small, aggregate PostHog metrics for the private Metabase sync."""
import json
import urllib.request

try:
    from .server import private_setting
except ImportError:  # Direct entry point: python3 telemetry/metabase_sync.py
    from server import private_setting


class PostHogReader:
    def __init__(self, project_id, api_key, capture_host, fetch=None):
        # Ingestion uses us.i.posthog.com; the private read API uses us.posthog.com.
        hosts = {"https://us.i.posthog.com": "https://us.posthog.com",
                 "https://eu.i.posthog.com": "https://eu.posthog.com"}
        if capture_host not in hosts or not project_id.isdecimal() or not api_key:
            raise ValueError("Invalid PostHog read configuration")
        self.base = f"{hosts[capture_host]}/api/projects/{project_id}"
        self.api_key = api_key
        self.fetch = fetch or urllib.request.urlopen

    @classmethod
    def configured(cls):
        project_id = private_setting("POSTHOG_PROJECT_ID")
        api_key = private_setting("POSTHOG_PERSONAL_API_KEY")
        if not project_id or not api_key:
            return None
        return cls(project_id, api_key, private_setting("POSTHOG_HOST") or "https://us.i.posthog.com")

    def post(self, path, body):
        request = urllib.request.Request(
            self.base + path, json.dumps(body).encode(),
            {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"})
        with self.fetch(request, timeout=30) as response:
            return json.load(response)

    def daily_usage(self):
        """Only daily totals, never PostHog event IDs or installation IDs."""
        data = self.post("/query/", {"query": {"kind": "HogQLQuery", "query": """
            SELECT toDate(timestamp) AS day, count() AS event_count,
                   sum(toInt(properties.active_seconds)) AS active_seconds,
                   uniqExact(distinct_id) AS active_installations
            FROM events
            WHERE event = 'manul active time' AND timestamp >= now() - INTERVAL 30 DAY
            GROUP BY day ORDER BY day LIMIT 31
        """}, "name": "manul_metabase_posthog_daily_usage"})
        if data.get("query_status") and not data["query_status"].get("complete"):
            raise ValueError("PostHog query did not complete")
        if data.get("columns") != ["day", "event_count", "active_seconds", "active_installations"]:
            raise ValueError("Unexpected PostHog query columns")
        rows = data["results"]
        if not isinstance(rows, list) or len(rows) > 31:
            raise ValueError("Unexpected PostHog query result")
        for row in rows:
            if (not isinstance(row, list) or len(row) != 4 or not isinstance(row[0], str)
                    or any(type(value) is not int or value < 0 for value in row[1:])):
                raise ValueError("Unexpected PostHog usage totals")
        return rows

    def operational_logs_7d(self):
        data = self.post("/logs/count/", {"query": {
            "dateRange": {"date_from": "-7d"}, "serviceNames": ["manul-telemetry"]}})
        count = data.get("count")
        if type(count) is not int or count < 0:
            raise ValueError("Unexpected PostHog log count")
        return count
