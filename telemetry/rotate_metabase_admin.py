"""Rotate the Metabase admin login while preserving the other settings in the private root .env."""
import json
import os
import secrets
import tempfile
import urllib.request
from pathlib import Path


BASE = "http://127.0.0.1:3300"
PRIVATE_FILE = Path(__file__).resolve().parent.parent / ".env"


def request(path, body=None, session=None, method=None):
    headers = {"Content-Type": "application/json"}
    if session:
        headers["X-Metabase-Session"] = session
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body else None,
                                 headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response) if response.status != 204 else None


def rotate():
    contents = PRIVATE_FILE.read_text(encoding="utf-8")
    values = dict(line.split("=", 1) for line in contents.splitlines() if "=" in line)
    email = values["METABASE_ADMIN_EMAIL"]
    current = values["METABASE_ADMIN_PASSWORD"]
    session = request("/api/session", {"username": email, "password": current})["id"]
    user = request("/api/user/current", session=session)
    if not user["is_superuser"] or user["email"] != email:
        raise ValueError("The private credentials must belong to the Metabase administrator")
    replacement = secrets.token_urlsafe(36)
    lines = contents.splitlines(keepends=True)
    if sum(line.partition("=")[0] == "METABASE_ADMIN_PASSWORD" for line in lines) != 1:
        raise ValueError("Expected exactly one METABASE_ADMIN_PASSWORD in the root .env")
    updated = "".join(f"METABASE_ADMIN_PASSWORD={replacement}\n" if line.partition("=")[0] == "METABASE_ADMIN_PASSWORD"
                      else line for line in lines)
    # Prepare the private replacement first. Only swap it into place after Metabase accepts the change.
    fd, name = tempfile.mkstemp(prefix=".env-", dir=PRIVATE_FILE.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(updated)
        request(f"/api/user/{user['id']}/password", {"password": replacement}, session, "PUT")
        os.replace(name, PRIVATE_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    request("/api/session", {"username": email, "password": replacement})
    print("Metabase admin password rotated and new login verified. Private copy: .env")


if __name__ == "__main__":
    rotate()
