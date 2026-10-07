"""One-time local Metabase setup, aggregate DB connection and owner dashboard.

Reads the private root .env; prints only IDs and the URL.
"""
import json
import os
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    from .server import private_setting
except ImportError:  # Direct entry point: python3 telemetry/metabase_setup.py
    from server import private_setting

BASE = "http://127.0.0.1:3300"
DASHBOARD_ID_FILE = Path(__file__).with_name("dashboard-id.txt")


def wait_for_metabase(timeout=120):
    deadline = time.monotonic() + timeout
    while True:
        try:
            if call("/api/health").get("status") == "ok":
                return
        except (OSError, ValueError, RuntimeError):
            pass
        if time.monotonic() >= deadline:
            raise TimeoutError("Metabase did not become healthy before setup")
        time.sleep(2)


def call(path, payload=None, session=None, method=None):
    headers = {"Content-Type": "application/json"}
    if session:
        headers["X-Metabase-Session"] = session
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode() if payload is not None else None,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Metabase {path} returned HTTP {exc.code}: {exc.read(400).decode()}") from exc


def main():
    email, password = private_setting("METABASE_ADMIN_EMAIL"), private_setting("METABASE_ADMIN_PASSWORD")
    if not email or not password:
        raise ValueError("Set METABASE_ADMIN_EMAIL and METABASE_ADMIN_PASSWORD in the root .env")
    wait_for_metabase()
    props = call("/api/session/properties")
    if props.get("setup-token"):
        call("/api/setup", {"token": props["setup-token"], "user": {"email": email, "password": password,
            "first_name": "Manul", "last_name": "Analytics"}, "prefs": {"site_name": "Manul analytics"}})
    session = call("/api/session", {"username": email, "password": password})["id"]
    databases = call("/api/database", session=session)["data"]
    match = next((db for db in databases if db["name"] == "Manul aggregates"), None)
    if match:
        db_id = match["id"]
    else:
        db_id = call("/api/database", {"name": "Manul aggregates", "engine": "sqlite",
            "details": {"db": "/data/analytics.sqlite"}, "is_full_sync": True}, session)["id"]
    print(f"Connected aggregate database {db_id}")

    dashboards = call("/api/dashboard", session=session)
    match = next((dashboard for dashboard in dashboards if dashboard["name"] == "Manul overview"), None)
    if match:
        dashboard_id = match["id"]
    else:
        dashboard_id = call("/api/dashboard", {"name": "Manul overview",
            "description": "Local opt-in usage, GitHub snapshots and PostHog ingestion/log aggregates. Installer requests are not completed installs."}, session)["id"]

    current = call(f"/api/dashboard/{dashboard_id}", session=session)
    existing_dashcards = {item["card_id"]: item["id"] for item in current.get("dashcards", []) if item.get("card_id")}
    cards = call("/api/card", session=session)
    specs = [
        ("Active time by day", "SELECT day, ROUND(active_seconds / 3600.0, 2) AS hours FROM daily_usage ORDER BY day", "line", 0, 0),
        ("Participating installations by day", "SELECT day, active_installations FROM daily_usage ORDER BY day", "line", 12, 0),
        ("Installer requests", "SELECT day, installer_requests FROM github_daily WHERE installer_requests IS NOT NULL ORDER BY day", "line", 0, 6),
        ("Stars and forks", "SELECT day, stars, forks FROM github_daily WHERE stars IS NOT NULL ORDER BY day", "line", 12, 6),
        ("Clone requests (14-day rolling)", "SELECT day, clone_requests_14d, unique_cloners_14d FROM github_daily WHERE clone_requests_14d IS NOT NULL ORDER BY day", "line", 0, 12),
        ("Installer assets", "SELECT release, name, requests FROM installer_assets WHERE day = (SELECT MAX(day) FROM installer_assets) ORDER BY requests DESC", "table", 12, 12),
        ("PostHog active time by day", "SELECT day, ROUND(active_seconds / 3600.0, 2) AS hours FROM posthog_daily ORDER BY day", "line", 0, 18),
        ("PostHog installations by day", "SELECT day, active_installations FROM posthog_daily ORDER BY day", "line", 12, 18),
        ("PostHog usage events (30-day rolling)", "SELECT usage_events_30d FROM posthog_snapshot WHERE day = (SELECT MAX(day) FROM posthog_snapshot)", "scalar", 0, 24),
        ("PostHog operational logs (7-day rolling)", "SELECT operational_logs_7d FROM posthog_snapshot WHERE day = (SELECT MAX(day) FROM posthog_snapshot)", "scalar", 12, 24),
        ("PostHog last successful sync (UTC)", "SELECT sampled_at AS last_success_utc, usage_events_30d, operational_logs_7d FROM posthog_snapshot ORDER BY day DESC LIMIT 1", "table", 0, 30),
    ]
    dashcards = []
    for name, sql, display, col, row in specs:
        card = next((item for item in cards if item["name"] == name), None)
        if not card:
            card = call("/api/card", {"name": name, "display": display,
                "dataset_query": {"database": db_id, "type": "native", "native": {"query": sql, "template-tags": {}}},
                "visualization_settings": {}}, session)
        dashcards.append({"id": existing_dashcards.get(card["id"], -(len(dashcards) + 1)), "card_id": card["id"],
                          "col": col, "row": row, "size_x": 12, "size_y": 6})
    call(f"/api/dashboard/{dashboard_id}/cards", {"cards": dashcards}, session, method="PUT")
    descriptor, temporary = tempfile.mkstemp(prefix=".dashboard-id-", dir=DASHBOARD_ID_FILE.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="ascii") as stream:
            stream.write(f"{dashboard_id}\n")
        os.replace(temporary, DASHBOARD_ID_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("Metabase dashboard ready: https://analytics.manul.si/dashboard")


if __name__ == "__main__":
    main()
