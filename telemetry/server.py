"""Private opt-in telemetry collector. Public traffic reaches it only via the gateway."""
import json
import os
import sqlite3
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import uuid
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import time

try:
    from .posthog_export import PostHogExporter
except ImportError:  # Direct script entry point: python3 telemetry/server.py
    from posthog_export import PostHogExporter

GITHUB_RELEASES = "https://api.github.com/repos/hormuz-labs/manul/releases"
GITHUB_REPO = "https://api.github.com/repos/hormuz-labs/manul"
GITHUB_CLONES = GITHUB_REPO + "/traffic/clones"
INSTALLERS = (".dmg", ".deb", ".AppImage")


def private_setting(name, env=None, file=None):
    env = os.environ if env is None else env
    if env.get(name):
        return env[name]
    file = Path(__file__).resolve().parent.parent / ".env" if file is None else Path(file)
    if file.exists():
        for line in file.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == name:
                return value.strip().strip("\"'")
    return ""


def github_traffic_token(env=None, file=None):
    """Optional GitHub credential, kept on the server and never returned to browsers."""
    use_cli = env is None and file is None
    token = private_setting("GITHUB_TRAFFIC_TOKEN", env, file)
    if token:
        return token
    if use_cli:
        try:
            result = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                return result.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            pass
    return ""


def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""CREATE TABLE IF NOT EXISTS usage (
        event_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL,
        active_seconds INTEGER NOT NULL, received_at INTEGER NOT NULL)""")
    db.execute("CREATE INDEX IF NOT EXISTS usage_received ON usage(received_at)")
    db.execute("""CREATE TABLE IF NOT EXISTS posthog_pending (
        event_id TEXT PRIMARY KEY REFERENCES usage(event_id))""")
    return db


def accept_usage(db, payload, *, forward=False):
    if not isinstance(payload, dict) or set(payload) != {"installationId", "eventId", "activeSeconds"}:
        raise ValueError("Expected installationId, eventId and activeSeconds")
    try:
        installation = str(uuid.UUID(payload["installationId"]))
        event = str(uuid.UUID(payload["eventId"]))
    except (ValueError, TypeError, AttributeError, KeyError) as exc:
        raise ValueError("Invalid ID") from exc
    seconds = payload["activeSeconds"]
    if type(seconds) is not int or not 1 <= seconds <= 3600:
        raise ValueError("Invalid activeSeconds")
    with db:
        inserted = db.execute("INSERT OR IGNORE INTO usage VALUES (?, ?, ?, ?)", (event, installation, seconds, int(time())))
        if inserted.rowcount and forward:
            db.execute("INSERT INTO posthog_pending(event_id) VALUES (?)", (event,))


def forward_pending(db_path, exporter, limit=100):
    """Retry stored events with stable PostHog UUIDs; never hold SQLite open on network I/O."""
    with closing(connect(db_path)) as db:
        rows = db.execute("""SELECT u.event_id, u.installation_id, u.active_seconds, u.received_at
                             FROM posthog_pending p JOIN usage u USING (event_id)
                             ORDER BY u.received_at, u.event_id LIMIT ?""", (limit,)).fetchall()
    sent = 0
    for event_id, installation_id, seconds, received_at in rows:
        exporter.active_time(event_id, installation_id, seconds, received_at)
        with closing(connect(db_path)) as db:
            with db:
                db.execute("DELETE FROM posthog_pending WHERE event_id = ?", (event_id,))
        sent += 1
    return sent


def start_posthog_worker(db_path, exporter, interval=15):
    stop = threading.Event()

    def run():
        while not stop.is_set():
            try:
                if forward_pending(db_path, exporter) == 100:
                    continue
            except (OSError, ValueError, urllib.error.URLError):
                print("PostHog product analytics delivery failed; queued for retry", file=sys.stderr, flush=True)
                try:
                    exporter.operational_log("Product analytics delivery failed; events queued for retry")
                except (OSError, ValueError, urllib.error.URLError):
                    print("PostHog logs delivery failed", file=sys.stderr, flush=True)
            stop.wait(interval)

    worker = threading.Thread(target=run, name="posthog-export", daemon=True)
    worker.start()
    return stop


def usage_stats(db):
    total, installations = db.execute(
        "SELECT COALESCE(SUM(active_seconds), 0), COUNT(DISTINCT installation_id) FROM usage"
    ).fetchone()
    recent, recent_installations = db.execute(
        "SELECT COALESCE(SUM(active_seconds), 0), COUNT(DISTINCT installation_id) FROM usage WHERE received_at >= ?",
        (int(time()) - 30 * 86400,),
    ).fetchone()
    return {"activeSeconds": total, "activeInstallations": installations,
            "last30Days": {"activeSeconds": recent, "activeInstallations": recent_installations}}


def download_stats(fetch=None, token=None):
    """GitHub Release download_count is asset requests, not people or installs.

    Do not include .zip auto-update assets, manifests or blockmaps: those are
    routinely fetched by running apps, not people downloading installers.
    """
    fetch = fetch or urllib.request.urlopen
    token = github_traffic_token() if token is None else token
    assets = []
    page = 1
    while True:
        request = urllib.request.Request(
            f"{GITHUB_RELEASES}?per_page=100&page={page}",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "Manul-telemetry/1",
                     **({"Authorization": f"Bearer {token}"} if token else {})},
        )
        with fetch(request, timeout=10) as response:
            releases = json.load(response)
        if not isinstance(releases, list):
            raise ValueError("GitHub returned an unexpected response")
        for release in releases:
            if release.get("draft") or release.get("prerelease"):
                continue
            for asset in release.get("assets", []):
                if asset["name"].endswith(INSTALLERS):
                    assets.append({"release": release["tag_name"], "name": asset["name"], "requests": asset["download_count"]})
        if len(releases) < 100:
            break
        page += 1
    return {"installerRequests": sum(a["requests"] for a in assets), "assets": assets}


def repository_stats(token="", fetch=None):
    """Current public star and fork totals for Manul."""
    fetch = fetch or urllib.request.urlopen
    request = urllib.request.Request(
        GITHUB_REPO,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "Manul-telemetry/1",
                 "X-GitHub-Api-Version": "2022-11-28",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with fetch(request, timeout=10) as response:
            data = json.load(response)
        stars, forks = data["stargazers_count"], data["forks_count"]
        if any(type(value) is not int or value < 0 for value in (stars, forks)):
            raise ValueError("Invalid repository totals")
        return {"stars": stars, "forks": forks}
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 429):
            return {"error": "GitHub is limiting repository requests. Try again later or configure a server-side GitHub credential."}
        return {"error": "GitHub star and fork totals are temporarily unavailable."}
    except (urllib.error.URLError, ValueError, KeyError, TypeError):
        return {"error": "GitHub star and fork totals are temporarily unavailable."}


def clone_stats(token, fetch=None):
    """GitHub reports clone requests and unique cloners for the rolling last 14 days."""
    if not token:
        return {"error": "Add GITHUB_TRAFFIC_TOKEN to the server's .env to show clone counts."}
    fetch = fetch or urllib.request.urlopen
    request = urllib.request.Request(
        GITHUB_CLONES + "?per=day",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "Manul-telemetry/1",
                 "X-GitHub-Api-Version": "2022-11-28", "Authorization": f"Bearer {token}"},
    )
    try:
        with fetch(request, timeout=10) as response:
            data = json.load(response)
        count, uniques = data["count"], data["uniques"]
        if any(type(value) is not int or value < 0 for value in (count, uniques)):
            raise ValueError("Invalid clone totals")
        return {"count": count, "uniques": uniques}
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 404):
            return {"error": "GitHub denied access to clone traffic. Check the server's GITHUB_TRAFFIC_TOKEN permissions."}
        return {"error": "GitHub clone traffic is temporarily unavailable."}
    except (urllib.error.URLError, ValueError, KeyError, TypeError):
        return {"error": "GitHub clone traffic is temporarily unavailable."}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, database, posthog=None):
        self.database = database
        self.posthog = posthog
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # The HTTP server must not retain IPs or installation IDs in access logs.

    def reply(self, code, data=None):
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/v1/usage":
            return self.reply(404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                return self.reply(413, {"error": "Payload too large or empty"})
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                return self.reply(415, {"error": "Expected JSON"})
            payload = json.loads(self.rfile.read(length))
            with closing(connect(self.server.database)) as db:
                accept_usage(db, payload, forward=bool(self.server.posthog))
        except (ValueError, TypeError):
            return self.reply(400, {"error": "Invalid usage event"})
        self.reply(204)

    def do_GET(self):
        if self.path == "/healthz":
            return self.reply(200, {"ok": True})
        self.reply(404)


if __name__ == "__main__":
    path = Path(os.environ.get("MANUL_TELEMETRY_DB", "usage.sqlite"))
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(path)):
        pass
    host = os.environ.get("MANUL_TELEMETRY_HOST", "127.0.0.1")
    port = int(os.environ.get("MANUL_TELEMETRY_PORT", "8788"))
    project_token = private_setting("POSTHOG_PROJECT_TOKEN")
    exporter = None
    if project_token:
        try:
            exporter = PostHogExporter(project_token, private_setting("POSTHOG_HOST") or "https://us.i.posthog.com")
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc
    try:
        server = Server((host, port), path, posthog=exporter)
    except OSError as exc:
        raise SystemExit(f"Collector could not bind to {host}:{port}: {exc.strerror}") from exc
    print(f"Telemetry listening on {server.server_address[0]}:{server.server_address[1]}", flush=True)
    if exporter:
        start_posthog_worker(path, exporter)
        print("PostHog Product Analytics and Logs export enabled", flush=True)
    server.serve_forever()
