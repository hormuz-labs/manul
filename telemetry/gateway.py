"""One public entry point: Metabase UI, plus anonymous desktop usage intake.

The Cloudflare tunnel points at this localhost-only gateway on port 8787.
Only POST /v1/usage is passed to the collector on port 8788; all other paths
go to Metabase. Credentials and dashboards never flow through the intake route.
"""
import http.client
import os
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

METABASE = ("127.0.0.1", 3300)
COLLECTOR = ("127.0.0.1", 8788)
DASHBOARD_ID_FILE = Path(__file__).with_name("dashboard-id.txt")
MAX_BODY = 2 * 1024 * 1024
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
               "trailer", "transfer-encoding", "upgrade", "host", "content-length"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass  # Do not retain IPs, cookies, or authorization headers in access logs.

    def do_GET(self):
        self.forward()

    def do_HEAD(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def do_PUT(self):
        self.forward()

    def do_DELETE(self):
        self.forward()

    def do_PATCH(self):
        self.forward()

    def forward(self):
        parsed = urlsplit(self.path)
        path = parsed.path
        if path == "/v1/usage":
            if self.command != "POST":
                return self.fail(405)
            target = COLLECTOR
        elif path.startswith("/v1/"):
            return self.fail(404)
        else:
            if self.command in ("GET", "HEAD") and path in ("/", "/dashboard", "/dashboard/"):
                try:
                    dashboard_id = DASHBOARD_ID_FILE.read_text(encoding="ascii").strip()
                except OSError:
                    return self.fail(503)
                if not dashboard_id.isascii() or not dashboard_id.isdecimal():
                    return self.fail(503)
                location = f"/dashboard/{dashboard_id}-manul-overview" + (f"?{parsed.query}" if parsed.query else "")
                self.send_response(302)
                self.send_header("Location", location)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            target = METABASE
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > MAX_BODY or self.headers.get("Transfer-Encoding"):
                return self.fail(413)
            body = self.rfile.read(length) if length else None
            headers = {key: value for key, value in self.headers.items() if key.lower() not in HOP_HEADERS}
            headers["Host"] = f"{target[0]}:{target[1]}"
            if target == METABASE:
                headers["X-Forwarded-Proto"] = "https" if self.headers.get("CF-Visitor") else "http"
                headers["X-Forwarded-Host"] = self.headers.get("Host", "analytics.manul.si")
            else:
                headers.pop("Authorization", None)
                headers.pop("Cookie", None)
            with closing(http.client.HTTPConnection(*target, timeout=30)) as upstream:
                upstream.request(self.command, self.path, body=body, headers=headers)
                response = upstream.getresponse()
                result = response.read()
                self.send_response(response.status)
                for key, value in response.getheaders():
                    if key.lower() not in HOP_HEADERS:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(result)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(result)
        except (OSError, ValueError, http.client.HTTPException):
            self.fail(502)

    def fail(self, status):
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()


if __name__ == "__main__":
    host = os.environ.get("MANUL_GATEWAY_HOST", "127.0.0.1")
    port = int(os.environ.get("MANUL_GATEWAY_PORT", "8787"))
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    print(f"Manul analytics gateway listening on {host}:{port}", flush=True)
    server.serve_forever()
