"""llm-ground-zero dashboard server. Stdlib only.

Run: python3 dashboard/server.py [port]   (default 7788)
Endpoints: /api/usage /api/tools /api/conversations /api/memories, / -> static.
Each endpoint degrades independently — an error in one data source returns
{"error": ...} for that panel instead of failing the page.
"""
import json
import os
import subprocess
import sys
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler

import lib

HOME = os.path.expanduser("~")
REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLAUDE_PROJECTS = os.path.join(HOME, ".claude", "projects")
CODEX_SESSIONS = os.path.join(HOME, ".codex", "sessions")
ENGRAM_DB = os.path.join(REPO_DIR, "data", "engram.db")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

_cache = {}
CACHE_TTL = 60


def cached(key, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_TTL:
        return hit[1]
    value = fn()
    _cache[key] = (now, value)
    return value


def get_usage():
    def run():
        out = subprocess.run(
            ["ccusage", "daily", "--json"],
            capture_output=True, text=True, timeout=120)
        if out.returncode != 0:
            return {"error": "ccusage failed: " + out.stderr.strip()[:300]}
        return json.loads(out.stdout)
    try:
        return cached("usage", run)
    except FileNotFoundError:
        return {"error": "ccusage not installed — run setup.sh"}
    except Exception as e:  # noqa: BLE001 — panel-level degradation by design
        return {"error": str(e)[:300]}


def get_tools():
    try:
        counts = cached("tools", lambda: lib.claude_tool_counts(CLAUDE_PROJECTS, days=30))
        return {"days": 30, "counts": counts}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:300]}


def get_conversations():
    def run():
        convs = (lib.claude_conversations(CLAUDE_PROJECTS, limit=15)
                 + lib.codex_conversations(CODEX_SESSIONS, limit=15))
        convs.sort(key=lambda c: c["mtime"], reverse=True)
        return convs[:20]
    try:
        return cached("convs", run)
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:300]}


def get_memories():
    try:
        return cached("mems", lambda: lib.recent_memories(ENGRAM_DB, limit=15))
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:300]}


ROUTES = {
    "/api/usage": get_usage,
    "/api/tools": get_tools,
    "/api/conversations": get_conversations,
    "/api/memories": get_memories,
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_GET(self):
        route = ROUTES.get(self.path.split("?")[0])
        if route is None:
            return super().do_GET()
        body = json.dumps(route()).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # quiet
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7788
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"llm-ground-zero dashboard → http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
