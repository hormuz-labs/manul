import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from unittest.mock import patch

from telemetry.server import Server, accept_usage, clone_stats, connect, download_stats, forward_pending, github_traffic_token, private_setting, repository_stats, usage_stats
from telemetry.posthog_export import PostHogExporter


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dbpath = Path(self.tmp.name) / "usage.sqlite"

    def tearDown(self):
        self.tmp.cleanup()

    def test_events_are_deduplicated_and_validated(self):
        payload = {"installationId": str(uuid.uuid4()), "eventId": str(uuid.uuid4()), "activeSeconds": 75}
        with connect(self.dbpath) as db:
            accept_usage(db, payload)
            accept_usage(db, payload)
            self.assertEqual(usage_stats(db)["activeSeconds"], 75)
            self.assertEqual(usage_stats(db)["activeInstallations"], 1)
            with self.assertRaises(ValueError):
                accept_usage(db, {**payload, "activeSeconds": True})
            with self.assertRaises(ValueError):
                accept_usage(db, {**payload, "projectName": "private"})
            self.assertEqual(db.execute("SELECT count(*) FROM posthog_pending").fetchone()[0], 0)

    def test_posthog_export_retries_only_once_with_stable_event_uuid(self):
        installation, event = str(uuid.uuid4()), str(uuid.uuid4())
        with connect(self.dbpath) as db:
            accept_usage(db, {"installationId": installation, "eventId": event, "activeSeconds": 75}, forward=True)
        captured = []

        class Response(io.BytesIO):
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        def failing(req, timeout):
            captured.append(json.loads(req.data))
            raise urllib.error.URLError("offline")

        exporter = PostHogExporter("phc_test", fetch=failing)
        with self.assertRaises(urllib.error.URLError):
            forward_pending(self.dbpath, exporter)
        self.assertEqual(len(captured), 1)
        with connect(self.dbpath) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM posthog_pending").fetchone()[0], 1)

        def successful(req, timeout):
            captured.append(json.loads(req.data))
            self.assertEqual(req.full_url, "https://us.i.posthog.com/capture/")
            return Response(b"{}")

        exporter.fetch = successful
        self.assertEqual(forward_pending(self.dbpath, exporter), 1)
        self.assertEqual(forward_pending(self.dbpath, exporter), 0)
        self.assertEqual([item["uuid"] for item in captured], [event, event])
        self.assertEqual(captured[1]["distinct_id"], installation)
        self.assertEqual(captured[1]["properties"]["active_seconds"], 75)
        self.assertIs(captured[1]["properties"]["$process_person_profile"], False)
        self.assertNotIn("project", str(captured[1]))

    def test_posthog_logs_use_otlp_with_only_operational_messages(self):
        sent = []

        class Response(io.BytesIO):
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        def fetch(req, timeout):
            sent.append(req)
            return Response(b"{}")

        PostHogExporter("phc_test", fetch=fetch).operational_log("Product analytics delivery failed; events queued for retry")
        self.assertEqual(sent[0].full_url, "https://us.i.posthog.com/i/v1/logs")
        self.assertEqual(sent[0].get_header("Authorization"), "Bearer phc_test")
        self.assertEqual(json.loads(sent[0].data)["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]["severityText"], "ERROR")

    def test_posthog_configuration_is_private_and_optional(self):
        env_file = Path(self.tmp.name) / ".env"
        self.assertEqual(private_setting("POSTHOG_PROJECT_TOKEN", env={}, file=env_file), "")
        env_file.write_text("POSTHOG_PROJECT_TOKEN=phc_private\nPOSTHOG_HOST=https://eu.i.posthog.com\n")
        self.assertEqual(private_setting("POSTHOG_PROJECT_TOKEN", env={}, file=env_file), "phc_private")
        self.assertEqual(private_setting("POSTHOG_HOST", env={}, file=env_file), "https://eu.i.posthog.com")
        self.assertEqual(private_setting("POSTHOG_PROJECT_TOKEN", env={"POSTHOG_PROJECT_TOKEN": "phc_env"}, file=env_file), "phc_env")

    def test_downloads_exclude_update_files(self):
        releases = [{"tag_name": "v1", "assets": [
            {"name": "Manul.dmg", "download_count": 4}, {"name": "Manul.zip", "download_count": 90},
            {"name": "manul.deb", "download_count": 3}, {"name": "manul.AppImage", "download_count": 2},
        ]}]

        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        result = download_stats(fetch=lambda _req, timeout: Response(json.dumps(releases).encode()), token="")
        self.assertEqual(result["installerRequests"], 9)
        self.assertEqual(len(result["assets"]), 3)

        def authenticated(req, timeout):
            self.assertEqual(req.get_header("Authorization"), "Bearer server-credential")
            return Response(json.dumps(releases).encode())

        self.assertEqual(download_stats(fetch=authenticated, token="server-credential")["installerRequests"], 9)

    def test_stars_and_forks_use_public_repo_totals(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        def fetch(req, timeout):
            self.assertEqual(req.full_url, "https://api.github.com/repos/hormuz-labs/manul")
            self.assertIsNone(req.get_header("Authorization"))
            return Response(json.dumps({"stargazers_count": 48, "forks_count": 7}).encode())

        self.assertEqual(repository_stats(fetch=fetch), {"stars": 48, "forks": 7})

        def authenticated(req, timeout):
            self.assertEqual(req.get_header("Authorization"), "Bearer github-credential")
            return Response(json.dumps({"stargazers_count": 48, "forks_count": 7}).encode())

        self.assertEqual(repository_stats("github-credential", fetch=authenticated), {"stars": 48, "forks": 7})

    def test_clones_use_server_only_github_credential(self):
        env_file = Path(self.tmp.name) / ".env"
        env_file.write_text("GITHUB_TRAFFIC_TOKEN=file-credential\n")
        self.assertEqual(github_traffic_token(env={}, file=env_file), "file-credential")
        self.assertEqual(github_traffic_token(env={"GITHUB_TRAFFIC_TOKEN": "env-credential"}, file=env_file), "env-credential")
        with patch("telemetry.server.subprocess.run") as run, patch("telemetry.server.os.environ", {}), \
                patch("telemetry.server.private_setting", return_value=""):
            run.return_value.returncode = 0
            run.return_value.stdout = "gh-cli-credential\n"
            self.assertEqual(github_traffic_token(), "gh-cli-credential")
            self.assertEqual(run.call_args.args[0], ["gh", "auth", "token"])
        self.assertIn("GITHUB_TRAFFIC_TOKEN", clone_stats("")["error"])

        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        def fetch(req, timeout):
            self.assertEqual(req.full_url, "https://api.github.com/repos/hormuz-labs/manul/traffic/clones?per=day")
            self.assertEqual(req.get_header("Authorization"), "Bearer github-credential")
            self.assertEqual(timeout, 10)
            return Response(json.dumps({"count": 25, "uniques": 13, "clones": []}).encode())

        self.assertEqual(clone_stats("github-credential", fetch=fetch), {"count": 25, "uniques": 13})

        def denied(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, None)

        self.assertIn("denied", clone_stats("github-credential", fetch=denied)["error"].lower())

    def test_http_collector_accepts_usage_only(self):
        server = Server(("127.0.0.1", 0), self.dbpath)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            payload = {"installationId": str(uuid.uuid4()), "eventId": str(uuid.uuid4()), "activeSeconds": 60}
            req = urllib.request.Request(base + "/v1/usage", json.dumps(payload).encode(), {"Content-Type": "application/json"})
            with urllib.request.urlopen(req) as res:
                self.assertEqual(res.status, 204)
            malformed = urllib.request.Request(base + "/v1/usage", b"{}", {"Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as err:
                urllib.request.urlopen(malformed)
            self.assertEqual(err.exception.code, 400)
            wrong_type = urllib.request.Request(base + "/v1/usage", b"{}", {"Content-Type": "text/plain"})
            with self.assertRaises(urllib.error.HTTPError) as err:
                urllib.request.urlopen(wrong_type)
            self.assertEqual(err.exception.code, 415)
            with urllib.request.urlopen(req) as res:
                self.assertEqual(res.status, 204)
            with self.assertRaises(urllib.error.HTTPError) as err:
                urllib.request.urlopen(base + "/v1/stats")
            self.assertEqual(err.exception.code, 404)
            with self.assertRaises(urllib.error.HTTPError) as err:
                urllib.request.urlopen(base + "/dashboard")
            self.assertEqual(err.exception.code, 404)
            with connect(self.dbpath) as db:
                self.assertEqual(usage_stats(db)["activeSeconds"], 60)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
