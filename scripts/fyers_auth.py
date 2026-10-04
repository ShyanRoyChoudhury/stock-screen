"""LOCAL DIAGNOSTIC tool only: mint a Fyers API v3 access token via the browser
OAuth flow so scripts/probe_intraday_source.py can read FYERS_ACCESS_TOKEN
from .env. The app's real login is the Admin page (the token is stored in
the data_feed_sessions table); nothing here is used by the app.

Step 1  GET  /api/v3/generate-authcode?client_id&redirect_uri&response_type=code&state
          -> you log in in the browser; Fyers redirects to
             <redirect_uri>?s=ok&code=200&auth_code=...&state=...
  Step 2  POST /api/v3/validate-authcode
          {grant_type: authorization_code, appIdHash: sha256("client_id:secret_key"), code}
          -> {access_token}

The access token expires at 06:00 IST the next morning, so this browser
login is needed once per trading day. Fyers' refresh-token API is disabled
(SEBI), so only the access token is saved or printed.

If FYERS_REDIRECT_URI points at localhost/127.0.0.1 the script listens on
that port and captures the auth_code itself; otherwise paste the URL the
browser lands on (the page itself may 404 -- the address bar is all we need).

Credentials (env vars or .env, see .env.example):
  FYERS_CLIENT_ID, FYERS_SECRET_KEY, FYERS_REDIRECT_URI  (login)

Run:
    .venv/bin/python scripts/fyers_auth.py               # browser login
    .venv/bin/python scripts/fyers_auth.py --write-env   # ...and save tokens to .env
"""

import argparse
import hashlib
import http.server
import os
import secrets
import sys
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests

API_BASE = "https://api-t1.fyers.in/api/v3"
ENV_PATH = Path(".env")
TIMEOUT = 30


def _load_env() -> None:
    """Load .env into os.environ (same approach as probe_intraday_source.py)."""
    try:
        from dotenv import load_dotenv
        load_dotenv(ENV_PATH)
        return
    except ImportError:
        pass
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def _require(*names: str) -> list[str]:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        sys.exit(f"missing env vars: {', '.join(missing)} (set them in .env)")
    return [os.environ[n] for n in names]


def _app_id_hash(client_id: str, secret_key: str) -> str:
    return hashlib.sha256(f"{client_id}:{secret_key}".encode()).hexdigest()


def _post(path: str, payload: dict) -> dict:
    resp = requests.post(f"{API_BASE}/{path}", json=payload, timeout=TIMEOUT)
    try:
        body = resp.json()
    except ValueError:
        sys.exit(f"{path}: HTTP {resp.status_code}, non-JSON body: {resp.text[:300]}")
    if body.get("s") != "ok":
        sys.exit(f"{path} failed: HTTP {resp.status_code} {body}")
    return body


def _capture_locally(redirect_uri: str) -> str:
    """Serve one request on the redirect URI's port and return the full URL hit."""
    parsed = urlparse(redirect_uri)
    port = parsed.port or 80
    captured: dict[str, str] = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            query = parse_qs(urlparse(self.path).query)
            if "auth_code" not in query and "s" not in query:
                self.send_response(404)  # favicon etc.
                self.end_headers()
                return
            captured["url"] = f"{parsed.scheme}://{parsed.netloc}{self.path}"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Fyers auth_code received - you can close this tab.")

        def log_message(self, *args):
            pass

    with http.server.HTTPServer((parsed.hostname, port), Handler) as server:
        print(f"Listening on {parsed.hostname}:{port} for the redirect ...")
        while "url" not in captured:
            server.handle_request()
    return captured["url"]


def _parse_auth_code(redirected: str, expected_state: str) -> str:
    redirected = redirected.strip()
    if "auth_code=" not in redirected:
        return redirected  # assume the bare auth_code was pasted
    query = {k: v[0] for k, v in parse_qs(urlparse(redirected).query).items()}
    if query.get("s") != "ok":
        sys.exit(f"login failed: {query}")
    if query.get("state") != expected_state:
        sys.exit(f"state mismatch (got {query.get('state')!r}, expected {expected_state!r})")
    return query["auth_code"]


def login() -> dict:
    client_id, secret_key, redirect_uri = _require(
        "FYERS_CLIENT_ID", "FYERS_SECRET_KEY", "FYERS_REDIRECT_URI")

    # Step 1: authorization URL.
    state = secrets.token_urlsafe(16)
    auth_url = f"{API_BASE}/generate-authcode?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": state,
    })
    print(f"\nStep 1 - log in here:\n\n  {auth_url}\n")
    webbrowser.open(auth_url)

    if urlparse(redirect_uri).hostname in ("127.0.0.1", "localhost"):
        redirected = _capture_locally(redirect_uri)
    else:
        redirected = input("Paste the full URL you were redirected to (or just the auth_code):\n> ")
    auth_code = _parse_auth_code(redirected, state)

    # Step 2: exchange auth_code for tokens.
    return _post("validate-authcode", {
        "grant_type": "authorization_code",
        "appIdHash": _app_id_hash(client_id, secret_key),
        "code": auth_code,
    })


def _write_env(updates: dict[str, str]) -> None:
    """Set KEY=value lines in .env, replacing existing keys and appending new ones."""
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    pending = dict(updates)
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if key in pending and not line.lstrip().startswith("#"):
            lines[i] = f"{key}={pending.pop(key)}"
    lines += [f"{k}={v}" for k, v in pending.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {', '.join(updates)} to {ENV_PATH}")


def _verify(client_id: str, access_token: str) -> None:
    """Sanity-check the token against GET /api/v3/profile."""
    resp = requests.get(f"{API_BASE}/profile", timeout=TIMEOUT,
                        headers={"Authorization": f"{client_id}:{access_token}"})
    body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    if body.get("s") == "ok":
        data = body.get("data", {})
        print(f"Verified: profile OK for {data.get('name')} ({data.get('fy_id')})")
    else:
        print(f"WARNING: profile check failed: HTTP {resp.status_code} {body or resp.text[:200]}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--write-env", action="store_true",
                        help="save FYERS_ACCESS_TOKEN into .env")
    args = parser.parse_args()

    _load_env()
    result = login()

    access_token = result["access_token"]
    tokens = {"FYERS_ACCESS_TOKEN": access_token}
    print()
    print(f"FYERS_ACCESS_TOKEN={access_token}")
    print()

    _verify(os.environ["FYERS_CLIENT_ID"], access_token)
    if args.write_env:
        _write_env(tokens)


if __name__ == "__main__":
    main()
