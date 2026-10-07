import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path

from telemetry.metabase_sync import sync
from telemetry.server import accept_usage, connect


class MetabaseSyncTests(unittest.TestCase):
    def test_only_aggregates_and_public_github_counts_are_exported(self):
        with tempfile.TemporaryDirectory() as directory:
            usage_path = Path(directory) / "usage.sqlite"
            out = Path(directory) / "analytics.sqlite"
            installation = str(uuid.uuid4())
            with connect(usage_path) as db:
                accept_usage(db, {"installationId": installation, "eventId": str(uuid.uuid4()), "activeSeconds": 75})
                accept_usage(db, {"installationId": installation, "eventId": str(uuid.uuid4()), "activeSeconds": 60})
            releases = lambda: {"installerRequests": 8, "assets": [{"release": "v1", "name": "manul.deb", "requests": 8}]}
            repository = lambda: {"stars": 2, "forks": 1}
            clones = lambda: {"count": 4, "uniques": 3}
            for _ in range(2):
                sync(usage_path, out, releases=releases, repository=repository, clones=clones,
                     posthog=False, now="2026-10-07")
            with sqlite3.connect(out) as db:
                self.assertEqual(db.execute("SELECT active_seconds, active_installations FROM daily_usage").fetchall(), [(135, 1)])
                self.assertEqual(db.execute("SELECT installer_requests, stars, forks, clone_requests_14d, unique_cloners_14d FROM github_daily").fetchall(), [(8, 2, 1, 4, 3)])
                self.assertEqual(db.execute("SELECT name, requests FROM installer_assets").fetchall(), [("manul.deb", 8)])
                tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertEqual(tables, {"daily_usage", "github_daily", "installer_assets",
                                          "posthog_daily", "posthog_snapshot"})
            self.assertNotIn(installation.encode(), out.read_bytes())

    def test_posthog_aggregate_snapshot_is_replaced_and_failures_preserve_last_success(self):
        class Reader:
            def __init__(self):
                self.days = [["2026-10-06", 2, 135, 1]]
                self.logs = 1

            def daily_usage(self):
                return self.days

            def operational_logs_7d(self):
                if self.logs is None:
                    raise OSError("read failure")
                return self.logs

        with tempfile.TemporaryDirectory() as directory:
            usage_path, out = Path(directory) / "usage.sqlite", Path(directory) / "analytics.sqlite"
            reader = Reader()
            args = {"releases": lambda: {"installerRequests": 0, "assets": []},
                    "repository": lambda: {"stars": 0, "forks": 0}, "clones": lambda: {"count": 0, "uniques": 0},
                    "posthog": reader, "now": "2026-10-07"}
            sync(usage_path, out, **args)
            with sqlite3.connect(out) as db:
                self.assertEqual(db.execute("SELECT usage_events_30d, operational_logs_7d FROM posthog_snapshot").fetchall(), [(2, 1)])
                self.assertEqual(db.execute("SELECT event_count, active_seconds, active_installations FROM posthog_daily").fetchall(), [(2, 135, 1)])

            reader.days, reader.logs = [], 0
            sync(usage_path, out, **args)
            with sqlite3.connect(out) as db:
                self.assertEqual(db.execute("SELECT count(*) FROM posthog_daily").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT usage_events_30d, operational_logs_7d FROM posthog_snapshot").fetchall(), [(0, 0)])

            reader.days, reader.logs = [["2026-10-06", 3, 200, 2]], None
            sync(usage_path, out, **args)
            with sqlite3.connect(out) as db:
                self.assertEqual(db.execute("SELECT count(*) FROM posthog_daily").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT usage_events_30d, operational_logs_7d FROM posthog_snapshot").fetchall(), [(0, 0)])

    def test_github_failures_preserve_last_good_sample_and_success_replaces_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            usage_path, out = Path(directory) / "usage.sqlite", Path(directory) / "analytics.sqlite"
            args = {"releases": lambda: {"installerRequests": 8, "assets": [
                        {"release": "v1", "name": "old.deb", "requests": 8}]},
                    "repository": lambda: {"stars": 2, "forks": 1},
                    "clones": lambda: {"count": 4, "uniques": 3},
                    "posthog": False, "now": "2026-10-07"}
            sync(usage_path, out, **args)
            args.update(releases=lambda: {}, repository=lambda: {"error": "rate limited"},
                        clones=lambda: (_ for _ in ()).throw(OSError("offline")))
            sync(usage_path, out, **args)
            with sqlite3.connect(out) as db:
                self.assertEqual(db.execute("SELECT installer_requests, stars, forks, clone_requests_14d, unique_cloners_14d FROM github_daily").fetchall(),
                                 [(8, 2, 1, 4, 3)])
                self.assertEqual(db.execute("SELECT name FROM installer_assets").fetchall(), [("old.deb",)])

            args.update(releases=lambda: {"installerRequests": 9, "assets": [
                            {"release": "v2", "name": "new.deb", "requests": 9}]},
                        repository=lambda: {"stars": 3, "forks": 2},
                        clones=lambda: {"count": 6, "uniques": 4})
            sync(usage_path, out, **args)
            with sqlite3.connect(out) as db:
                self.assertEqual(db.execute("SELECT installer_requests, stars, forks, clone_requests_14d, unique_cloners_14d FROM github_daily").fetchall(),
                                 [(9, 3, 2, 6, 4)])
                self.assertEqual(db.execute("SELECT name FROM installer_assets").fetchall(), [("new.deb",)])

    def test_posthog_daily_rows_expire_outside_the_rolling_window(self):
        class Reader:
            days = [["2026-09-01", 1, 60, 1]]

            def daily_usage(self):
                return self.days

            def operational_logs_7d(self):
                return 0

        with tempfile.TemporaryDirectory() as directory:
            usage_path, out = Path(directory) / "usage.sqlite", Path(directory) / "analytics.sqlite"
            reader = Reader()
            args = {"releases": lambda: {"installerRequests": 0, "assets": []},
                    "repository": lambda: {"stars": 0, "forks": 0},
                    "clones": lambda: {"count": 0, "uniques": 0}, "posthog": reader}
            sync(usage_path, out, now="2026-09-01", **args)
            reader.days = []
            sync(usage_path, out, now="2026-10-07", **args)
            with sqlite3.connect(out) as db:
                self.assertEqual(db.execute("SELECT day FROM posthog_daily").fetchall(), [])
                self.assertEqual(db.execute("SELECT usage_events_30d FROM posthog_snapshot ORDER BY day DESC LIMIT 1").fetchone(), (0,))

if __name__ == "__main__":
    unittest.main()
