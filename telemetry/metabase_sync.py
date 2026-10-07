"""Build an aggregate-only SQLite source for self-hosted Metabase.

No installation IDs, event IDs or token values appear in this database. GitHub
figures are snapshots: release counts are cumulative and clone data rolls over.
"""
import argparse
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone

try:
    from .posthog_read import PostHogReader
    from .server import clone_stats, connect, download_stats, github_traffic_token, repository_stats
except ImportError:  # Direct entry point: python3 telemetry/metabase_sync.py
    from posthog_read import PostHogReader
    from server import clone_stats, connect, download_stats, github_traffic_token, repository_stats


def sync(usage_path, analytics_path, *, releases=download_stats, repository=None, clones=None, now=None, posthog=None):
    today = now or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    reader = PostHogReader.configured() if posthog is None else posthog
    with closing(connect(usage_path)) as usage, closing(sqlite3.connect(analytics_path)) as analytics:
        analytics.execute("""CREATE TABLE IF NOT EXISTS daily_usage (
            day TEXT PRIMARY KEY, active_seconds INTEGER NOT NULL,
            active_installations INTEGER NOT NULL)""")
        analytics.execute("""CREATE TABLE IF NOT EXISTS github_daily (
            day TEXT PRIMARY KEY, installer_requests INTEGER,
            stars INTEGER, forks INTEGER, clone_requests_14d INTEGER,
            unique_cloners_14d INTEGER)""")
        analytics.execute("""CREATE TABLE IF NOT EXISTS installer_assets (
            day TEXT NOT NULL, release TEXT NOT NULL, name TEXT NOT NULL,
            requests INTEGER NOT NULL, PRIMARY KEY (day, release, name))""")
        analytics.execute("""CREATE TABLE IF NOT EXISTS posthog_daily (
            day TEXT PRIMARY KEY, event_count INTEGER NOT NULL,
            active_seconds INTEGER NOT NULL, active_installations INTEGER NOT NULL)""")
        analytics.execute("""CREATE TABLE IF NOT EXISTS posthog_snapshot (
            day TEXT PRIMARY KEY, usage_events_30d INTEGER NOT NULL,
            operational_logs_7d INTEGER NOT NULL, sampled_at TEXT NOT NULL)""")
        rows = usage.execute("""SELECT date(received_at, 'unixepoch'), SUM(active_seconds),
                                  COUNT(DISTINCT installation_id) FROM usage GROUP BY 1""").fetchall()
        with analytics:
            analytics.executemany("""INSERT INTO daily_usage VALUES (?, ?, ?)
                ON CONFLICT(day) DO UPDATE SET active_seconds=excluded.active_seconds,
                active_installations=excluded.active_installations""", rows)

            token = github_traffic_token()
            def sample(source, fields, name):
                try:
                    result = source()
                    if not isinstance(result, dict) or any(type(result.get(field)) is not int or result[field] < 0
                                                           for field in fields):
                        raise ValueError("Missing or invalid GitHub totals")
                    return result
                except (OSError, ValueError, KeyError, TypeError):
                    print(f"GitHub {name} sample failed; retaining previous totals where available", file=sys.stderr, flush=True)
                    return {}

            downloads = sample(releases, ("installerRequests",), "releases")
            repo = sample(repository or (lambda: repository_stats(token)), ("stars", "forks"), "repository")
            traffic = sample(clones or (lambda: clone_stats(token)), ("count", "uniques"), "clones")
            analytics.execute("""INSERT INTO github_daily VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(day) DO UPDATE SET
                    installer_requests=COALESCE(excluded.installer_requests, github_daily.installer_requests),
                    stars=COALESCE(excluded.stars, github_daily.stars),
                    forks=COALESCE(excluded.forks, github_daily.forks),
                    clone_requests_14d=COALESCE(excluded.clone_requests_14d, github_daily.clone_requests_14d),
                    unique_cloners_14d=COALESCE(excluded.unique_cloners_14d, github_daily.unique_cloners_14d)""",
                (today, downloads.get("installerRequests"), repo.get("stars"), repo.get("forks"),
                 traffic.get("count"), traffic.get("uniques")))
            if "assets" in downloads:
                analytics.execute("DELETE FROM installer_assets WHERE day = ?", (today,))
                analytics.executemany("""INSERT INTO installer_assets VALUES (?, ?, ?, ?)
                    ON CONFLICT(day, release, name) DO UPDATE SET requests=excluded.requests""",
                    [(today, a["release"], a["name"], a["requests"]) for a in downloads["assets"]])
        if reader:
            try:
                days = reader.daily_usage()
                logs_7d = reader.operational_logs_7d()
                with analytics:
                    analytics.execute("DELETE FROM posthog_daily")
                    analytics.executemany("INSERT INTO posthog_daily VALUES (?, ?, ?, ?)", days)
                    analytics.execute("""INSERT INTO posthog_snapshot VALUES (?, ?, ?, ?)
                        ON CONFLICT(day) DO UPDATE SET usage_events_30d=excluded.usage_events_30d,
                            operational_logs_7d=excluded.operational_logs_7d, sampled_at=excluded.sampled_at""",
                        (today, sum(day[1] for day in days), logs_7d, datetime.now(timezone.utc).isoformat()))
            except (OSError, ValueError, KeyError, TypeError, sqlite3.Error):
                # Preserve the last successful PostHog snapshot; never misreport failed reads as zero.
                print("PostHog aggregate read failed; keeping previous snapshot", file=sys.stderr, flush=True)
    return len(rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync aggregate Manul data into a Metabase-friendly SQLite file")
    parser.add_argument("--usage", required=True, help="collector usage.sqlite")
    parser.add_argument("--out", required=True, help="aggregate SQLite output")
    args = parser.parse_args()
    try:
        days = sync(args.usage, args.out)
        print(f"Updated {days} daily usage rows and today's GitHub snapshot", flush=True)
    except (OSError, sqlite3.Error) as exc:
        print(f"Metabase sync failed: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1) from exc
