import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from unittest.mock import patch

from telemetry.gateway import Handler, ThreadingHTTPServer
from telemetry.server import Server as Collector


class GatewayTests(unittest.TestCase):
    def test_metabase_is_the_only_ui_and_usage_reaches_collector(self):
        class MetabaseHandler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                body = f"<html>{self.path}</html>".encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "usage.sqlite"
            collector = Collector(("127.0.0.1", 0), database, "private-token")
            metabase = ThreadingHTTPServer(("127.0.0.1", 0), MetabaseHandler)
            gateway = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            dashboard_file = Path(directory) / "dashboard-id.txt"
            dashboard_file.write_text("7\n")
            with patch("telemetry.gateway.COLLECTOR", ("127.0.0.1", collector.server_port)), \
                    patch("telemetry.gateway.METABASE", ("127.0.0.1", metabase.server_port)), \
                    patch("telemetry.gateway.DASHBOARD_ID_FILE", dashboard_file):
                threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (collector, metabase, gateway)]
                for thread in threads:
                    thread.start()
                base = f"http://127.0.0.1:{gateway.server_port}"
                try:
                    class NoRedirect(urllib.request.HTTPRedirectHandler):
                        def redirect_request(self, *_args):
                            return None

                    opener = urllib.request.build_opener(NoRedirect)
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        opener.open(base + "/")
                    self.assertEqual(error.exception.code, 302)
                    self.assertEqual(error.exception.headers["Location"], "/dashboard")
                    for path in ("/dashboard", "/dashboard/"):
                        with urllib.request.urlopen(base + path) as response:
                            self.assertEqual(response.status, 200)
                            self.assertIn(b'src="/dashboard/7-manul-overview"', response.read())
                            self.assertIn("frame-src 'self'", response.headers["Content-Security-Policy"])
                    with urllib.request.urlopen(urllib.request.Request(base + "/dashboard", method="HEAD")) as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.read(), b"")
                    with urllib.request.urlopen(base + "/dashboard?period=one&notes=%22x%22") as response:
                        self.assertIn(b"/dashboard/7-manul-overview?period=one&amp;notes=%22x%22", response.read())
                    dashboard_file.write_text("9\n")
                    with urllib.request.urlopen(base + "/dashboard") as response:
                        self.assertIn(b'src="/dashboard/9-manul-overview"', response.read())
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        opener.open(base + "/dashboard/9-manul-overview?period=month")
                    self.assertEqual(error.exception.code, 302)
                    self.assertEqual(error.exception.headers["Location"], "/dashboard?period=month")
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        opener.open(base + "/dashboard/2-manul-overview")
                    self.assertEqual(error.exception.headers["Location"], "/dashboard")
                    with urllib.request.urlopen(base + "/dashboard/9-manul-overview/edit") as response:
                        self.assertEqual(response.headers["X-Frame-Options"], "DENY")
                        self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
                    frame_request = urllib.request.Request(base + "/dashboard/9-manul-overview",
                                                           headers={"Sec-Fetch-Dest": "iframe"})
                    with urllib.request.urlopen(frame_request) as response:
                        self.assertEqual(response.status, 200)
                        self.assertIsNone(response.headers.get("X-Frame-Options"))
                        self.assertIn("frame-ancestors 'self'", response.headers["Content-Security-Policy"])
                    with urllib.request.urlopen(base + "/auth/login") as response:
                        self.assertIn(b"/auth/login", response.read())
                        self.assertEqual(response.headers["X-Frame-Options"], "DENY")
                    dashboard_file.unlink()
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        opener.open(base + "/dashboard")
                    self.assertEqual(error.exception.code, 503)
                    with urllib.request.urlopen(base + "/api/session/properties") as response:
                        self.assertIn(b"/api/session/properties", response.read())
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
                    for server in (gateway, metabase, collector):
                        server.shutdown()
                        server.server_close()
                    for thread in threads:
                        thread.join()


if __name__ == "__main__":
    unittest.main()
