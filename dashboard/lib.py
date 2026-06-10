"""Pure data-extraction functions for the llm-ground-zero dashboard.

Everything here takes filesystem paths in and returns plain dicts/lists out,
so it can be unit-tested without HTTP or real agent installs.
"""
import glob
import json
import os
import sqlite3
import time


def _iter_jsonl(path):
    try:
        with open(path, errors="replace") as f:
            for line in f:
                try:
                    yield json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
    except OSError:
        return


def _first_text(content):
    """Extract displayable user text from a Claude message content field."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                return block.get("text", "")
    return ""


def _is_noise(text):
    """Command wrappers, env context, tool results — not a real prompt."""
    t = text.strip()
    return not t or t.startswith("<") or t.startswith("Caveat:")


def claude_conversations(projects_root, limit=20):
    """Recent Claude Code sessions: first real user prompt per session file."""
    files = glob.glob(os.path.join(projects_root, "*", "*.jsonl"))
    files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    convs = []
    for path in files[: limit * 3]:  # over-scan: some sessions have no real prompt
        title = cwd = ts = None
        for row in _iter_jsonl(path):
            if row.get("type") != "user":
                continue
            text = _first_text(row.get("message", {}).get("content"))
            if _is_noise(text):
                continue
            title, cwd, ts = text, row.get("cwd", ""), row.get("timestamp", "")
            break
        if title:
            convs.append({
                "agent": "claude",
                "project": os.path.basename(cwd) if cwd else "?",
                "title": title.strip()[:160],
                "time": ts,
                "mtime": os.path.getmtime(path),
            })
        if len(convs) >= limit:
            break
    return convs


def claude_tool_counts(projects_root, days=30):
    """Count tool_use blocks by tool name across recent Claude session logs."""
    cutoff = time.time() - days * 86400
    counts = {}
    for path in glob.glob(os.path.join(projects_root, "*", "*.jsonl")):
        try:
            if os.path.getmtime(path) < cutoff:
                continue
        except OSError:
            continue
        for row in _iter_jsonl(path):
            if row.get("type") != "assistant":
                continue
            content = row.get("message", {}).get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    name = block.get("name", "?")
                    counts[name] = counts.get(name, 0) + 1
    return counts


def codex_conversations(sessions_root, limit=20):
    """Recent Codex sessions: cwd from session_meta, first real user message."""
    files = glob.glob(os.path.join(sessions_root, "**", "rollout-*.jsonl"),
                      recursive=True)
    files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    convs = []
    for path in files[: limit * 3]:
        cwd = ts = ""
        title = None
        for row in _iter_jsonl(path):
            payload = row.get("payload", {})
            if row.get("type") == "session_meta":
                cwd = payload.get("cwd", "")
                ts = payload.get("timestamp", row.get("timestamp", ""))
            elif payload.get("type") == "message" and payload.get("role") == "user":
                text = " ".join(
                    b.get("text", "") for b in payload.get("content", [])
                    if isinstance(b, dict)
                )
                if _is_noise(text):
                    continue
                title = text
                break
        if title:
            convs.append({
                "agent": "codex",
                "project": os.path.basename(cwd) if cwd else "?",
                "title": title.strip()[:160],
                "time": ts,
                "mtime": os.path.getmtime(path),
            })
        if len(convs) >= limit:
            break
    return convs


def recent_memories(db_path, limit=15):
    """Latest non-deleted Engram observations. Read-only; safe if DB missing."""
    if not os.path.exists(db_path):
        return []
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        rows = con.execute(
            """SELECT type, title, content, project, created_at
               FROM observations WHERE deleted_at IS NULL
               ORDER BY created_at DESC LIMIT ?""", (limit,)).fetchall()
        con.close()
    except sqlite3.Error:
        return []
    return [
        {"type": t, "title": ti, "content": (c or "")[:240],
         "project": p or "", "created_at": ca}
        for t, ti, c, p, ca in rows
    ]
