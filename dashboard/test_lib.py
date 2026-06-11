"""Unit tests for dashboard/lib.py parsers. Run: python3 dashboard/test_lib.py"""
import json
import os
import sqlite3
import tempfile
import unittest

import lib


def write_jsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


class ClaudeSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def _session(self, name="proj-a/s1.jsonl", rows=None):
        path = os.path.join(self.root, name)
        write_jsonl(path, rows or [])
        return path

    def test_extracts_first_user_text_cwd_and_time(self):
        self._session(rows=[
            {"type": "mode", "mode": "normal", "sessionId": "s1"},
            {"type": "user", "timestamp": "2026-06-10T10:00:00.000Z",
             "cwd": "/Users/x/myproj", "sessionId": "s1",
             "message": {"role": "user", "content": "Fix the login bug please"}},
            {"type": "assistant", "timestamp": "2026-06-10T10:00:05.000Z",
             "message": {"role": "assistant", "content": [
                 {"type": "tool_use", "name": "Bash", "input": {}},
                 {"type": "tool_use", "name": "Edit", "input": {}}]}},
        ])
        convs = lib.claude_conversations(self.root, limit=10)
        self.assertEqual(len(convs), 1)
        c = convs[0]
        self.assertEqual(c["agent"], "claude")
        self.assertEqual(c["project"], "myproj")
        self.assertEqual(c["title"], "Fix the login bug please")
        self.assertEqual(c["time"], "2026-06-10T10:00:00.000Z")

    def test_skips_command_and_list_content_until_real_text(self):
        self._session(rows=[
            {"type": "user", "timestamp": "2026-06-10T09:00:00.000Z", "cwd": "/p",
             "message": {"role": "user", "content": "<command-name>/model</command-name>"}},
            {"type": "user", "timestamp": "2026-06-10T09:01:00.000Z", "cwd": "/p",
             "message": {"role": "user", "content": [
                 {"type": "tool_result", "content": "stuff"},
                 {"type": "text", "text": "Actual question here"}]}},
        ])
        convs = lib.claude_conversations(self.root, limit=10)
        self.assertEqual(convs[0]["title"], "Actual question here")

    def test_counts_tool_use_across_sessions(self):
        self._session("proj-a/s1.jsonl", rows=[
            {"type": "assistant", "timestamp": "2026-06-10T10:00:00.000Z",
             "message": {"content": [
                 {"type": "tool_use", "name": "Bash"},
                 {"type": "tool_use", "name": "Bash"},
                 {"type": "tool_use", "name": "Read"}]}},
        ])
        self._session("proj-b/s2.jsonl", rows=[
            {"type": "assistant", "timestamp": "2026-06-10T11:00:00.000Z",
             "message": {"content": [{"type": "tool_use", "name": "Bash"}]}},
        ])
        counts = lib.claude_tool_counts(self.root, days=3650)
        self.assertEqual(counts["Bash"], 3)
        self.assertEqual(counts["Read"], 1)


class CodexSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_extracts_meta_and_skips_env_context(self):
        path = os.path.join(self.root, "2026/06/06/rollout-x.jsonl")
        write_jsonl(path, [
            {"timestamp": "2026-06-06T10:59:13.989Z", "type": "session_meta",
             "payload": {"id": "abc", "cwd": "/Users/x/officebrew",
                          "timestamp": "2026-06-06T10:59:13.866Z"}},
            {"type": "response_item", "payload": {
                "type": "message", "role": "user",
                "content": [{"type": "input_text", "text": "<environment_context>...</environment_context>"}]}},
            {"type": "response_item", "payload": {
                "type": "message", "role": "user",
                "content": [{"type": "input_text", "text": "Build the brew scheduler"}]}},
        ])
        convs = lib.codex_conversations(self.root, limit=10)
        self.assertEqual(len(convs), 1)
        c = convs[0]
        self.assertEqual(c["agent"], "codex")
        self.assertEqual(c["project"], "officebrew")
        self.assertEqual(c["title"], "Build the brew scheduler")


class MemoryTests(unittest.TestCase):
    def test_reads_recent_observations(self):
        with tempfile.TemporaryDirectory() as d:
            db = os.path.join(d, "engram.db")
            con = sqlite3.connect(db)
            con.execute("""CREATE TABLE observations (
                id INTEGER PRIMARY KEY, session_id TEXT, type TEXT, title TEXT,
                content TEXT, project TEXT, created_at TEXT, deleted_at TEXT)""")
            con.execute("""INSERT INTO observations
                (session_id,type,title,content,project,created_at) VALUES
                ('s','note','setup test','hello','llm-ground-zero','2026-06-10 10:00:00')""")
            con.execute("""INSERT INTO observations
                (session_id,type,title,content,project,created_at,deleted_at) VALUES
                ('s','note','deleted one','x','p','2026-06-10 11:00:00','2026-06-10 12:00:00')""")
            con.commit(); con.close()
            mems = lib.recent_memories(db, limit=10)
            self.assertEqual(len(mems), 1)
            self.assertEqual(mems[0]["title"], "setup test")


if __name__ == "__main__":
    unittest.main(verbosity=2)
