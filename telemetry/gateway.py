"""One public entry point: Metabase UI, plus anonymous desktop usage intake.

The Cloudflare tunnel points at this localhost-only gateway on port 8787.
Only POST /v1/usage is passed to the collector on port 8788; all other paths
go to Metabase, except /dashboard, which frames the private dashboard at a
stable URL. Credentials and dashboards never flow through the intake route.
"""
import http.client
import os
import re
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from html import escape
from pathlib import Path
from urllib.parse import urlsplit

METABASE = ("127.0.0.1", 3300)
COLLECTOR = ("127.0.0.1", 8788)
DASHBOARD_ID_FILE = Path(__file__).with_name("dashboard-id.txt")
DASHBOARD_ROUTE = re.compile(r"/dashboard/\d+-manul-overview/?$")
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
            if self.command in ("GET", "HEAD") and path == "/":
                self.send_response(302)
                self.send_header("Location", "/dashboard" + (f"?{parsed.query}" if parsed.query else ""))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if self.command in ("GET", "HEAD") and path in ("/dashboard", "/dashboard/"):
                return self.dashboard(parsed.query)
            # Keep the ID-based route for the frame; canonicalize direct visits and old bookmarks.
            if (self.command in ("GET", "HEAD") and DASHBOARD_ROUTE.fullmatch(path)
                    and self.headers.get("Sec-Fetch-Dest") != "iframe"):
                self.send_response(302)
                self.send_header("Location", "/dashboard" + (f"?{parsed.query}" if parsed.query else ""))
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
                framed = (target == METABASE and self.command in ("GET", "HEAD")
                          and self.headers.get("Sec-Fetch-Dest") == "iframe"
                          and response.getheader("Content-Type", "").lower().startswith("text/html"))
                for key, value in response.getheaders():
                    if key.lower() not in HOP_HEADERS:
                        if framed and key.lower() == "x-frame-options":
                            continue
                        if framed and key.lower() == "content-security-policy":
                            value = value.replace("frame-ancestors 'none'", "frame-ancestors 'self'")
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(result)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(result)
        except (OSError, ValueError, http.client.HTTPException):
            self.fail(502)

    def dashboard(self, query):
        try:
            dashboard_id = DASHBOARD_ID_FILE.read_text(encoding="ascii").strip()
        except OSError:
            return self.fail(503)
        if not dashboard_id.isascii() or not dashboard_id.isdecimal():
            return self.fail(503)
        src = f"/dashboard/{dashboard_id}-manul-overview" + (f"?{query}" if query else "")
        body = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                "<title>Manul analytics</title><style>html,body{margin:0;width:100%;height:100%}"
                "iframe{border:0;width:100%;height:100%}</style></head><body>"
                f"<iframe title=\"Manul analytics dashboard\" src=\"{escape(src, quote=True)}\"></iframe>"
                "</body></html>").encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

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
