import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from unittest.mock import patch

from telemetry.gateway import Handler, ThreadingHTTPServer
from telemetry.server import Server as Collector


class GatewayTests(unittest.TestCase):
    def test_metabase_is_the_only_ui_and_usage_reaches_collector(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "usage.sqlite"
            collector = Collector(("127.0.0.1", 0), database, "private-token")
            gateway = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            dashboard_file = Path(directory) / "dashboard-id.txt"
            dashboard_file.write_text("7\n")
            with patch("telemetry.gateway.COLLECTOR", ("127.0.0.1", collector.server_port)), \
                    patch("telemetry.gateway.METABASE", ("127.0.0.1", collector.server_port)), \
                    patch("telemetry.gateway.DASHBOARD_ID_FILE", dashboard_file):
                threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (collector, gateway)]
                for thread in threads:
                    thread.start()
                base = f"http://127.0.0.1:{gateway.server_port}"
                try:
                    class NoRedirect(urllib.request.HTTPRedirectHandler):
                        def redirect_request(self, *_args):
                            return None

                    opener = urllib.request.build_opener(NoRedirect)
                    for path in ("/", "/dashboard", "/dashboard/"):
                        with self.assertRaises(urllib.error.HTTPError) as error:
                            opener.open(base + path)
                        self.assertEqual(error.exception.code, 302)
                        self.assertEqual(error.exception.headers["Location"], "/dashboard/7-manul-overview")
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        opener.open(base + "/dashboard?period=month")
                    self.assertEqual(error.exception.headers["Location"], "/dashboard/7-manul-overview?period=month")
                    dashboard_file.write_text("9\n")
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        opener.open(base + "/dashboard")
                    self.assertEqual(error.exception.headers["Location"], "/dashboard/9-manul-overview")
                    dashboard_file.unlink()
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        opener.open(base + "/dashboard")
                    self.assertEqual(error.exception.code, 503)
                    with urllib.request.urlopen(base + "/healthz") as response:
                        self.assertEqual(json.load(response), {"ok": True})
                    event = {"installationId": str(uuid.uuid4()), "eventId": str(uuid.uuid4()), "activeSeconds": 72}
                    request = urllib.request.Request(base + "/v1/usage", json.dumps(event).encode(),
                                                     {"Content-Type": "application/json"})
                    with urllib.request.urlopen(request) as response:
                        self.assertEqual(response.status, 204)
                    with sqlite3.connect(database) as db:
                        self.assertEqual(db.execute("SELECT SUM(active_seconds) FROM usage").fetchone()[0], 72)
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(base + "/v1/usage")
                    self.assertEqual(error.exception.code, 405)
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(base + "/v1/stats")
                    self.assertEqual(error.exception.code, 404)
                finally:
                    for server in (gateway, collector):
                        server.shutdown()
                        server.server_close()
                    for thread in threads:
                        thread.join()


if __name__ == "__main__":
    unittest.main()
