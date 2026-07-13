const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lib = require("../lib");

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lgz-lib-"));

test("claudeConversations extracts first user text, cwd and time", () => {
  const root = tmp();
  writeJsonl(path.join(root, "proj-a", "s1.jsonl"), [
    { type: "mode", mode: "normal", sessionId: "s1" },
    { type: "user", timestamp: "2026-06-10T10:00:00.000Z",
      cwd: "/Users/x/myproj", sessionId: "s1",
      message: { role: "user", content: "Fix the login bug please" } },
    { type: "assistant", timestamp: "2026-06-10T10:00:05.000Z",
      message: { role: "assistant", content: [
        { type: "tool_use", name: "Bash", input: {} },
        { type: "tool_use", name: "Edit", input: {} }] } },
  ]);
  const convs = lib.claudeConversations(root, 10);
  assert.strictEqual(convs.length, 1);
  assert.strictEqual(convs[0].agent, "claude");
  assert.strictEqual(convs[0].project, "myproj");
  assert.strictEqual(convs[0].title, "Fix the login bug please");
  assert.strictEqual(convs[0].time, "2026-06-10T10:00:00.000Z");
});

test("claudeConversations skips command wrappers and tool results", () => {
  const root = tmp();
  writeJsonl(path.join(root, "p", "s.jsonl"), [
    { type: "user", timestamp: "2026-06-10T09:00:00.000Z", cwd: "/p",
      message: { role: "user", content: "<command-name>/model</command-name>" } },
    { type: "user", timestamp: "2026-06-10T09:01:00.000Z", cwd: "/p",
      message: { role: "user", content: [
        { type: "tool_result", content: "stuff" },
        { type: "text", text: "Actual question here" }] } },
  ]);
  assert.strictEqual(lib.claudeConversations(root, 10)[0].title,
    "Actual question here");
});

test("claudeToolCounts counts tool_use across sessions", () => {
  const root = tmp();
  writeJsonl(path.join(root, "proj-a", "s1.jsonl"), [
    { type: "assistant", message: { content: [
      { type: "tool_use", name: "Bash" },
      { type: "tool_use", name: "Bash" },
      { type: "tool_use", name: "Read" }] } },
  ]);
  writeJsonl(path.join(root, "proj-b", "s2.jsonl"), [
    { type: "assistant", message: { content: [
      { type: "tool_use", name: "Bash" }] } },
  ]);
  const counts = lib.claudeToolCounts(root, 3650);
  assert.strictEqual(counts.Bash, 3);
  assert.strictEqual(counts.Read, 1);
});

test("codexConversations reads meta and skips env context", () => {
  const root = tmp();
  writeJsonl(path.join(root, "2026", "06", "06", "rollout-x.jsonl"), [
    { timestamp: "2026-06-06T10:59:13.989Z", type: "session_meta",
      payload: { id: "abc", cwd: "/Users/x/officebrew",
                 timestamp: "2026-06-06T10:59:13.866Z" } },
    { type: "response_item", payload: { type: "message", role: "user",
      content: [{ type: "input_text",
                  text: "<environment_context>...</environment_context>" }] } },
    { type: "response_item", payload: { type: "message", role: "user",
      content: [{ type: "input_text",
                  text: "# AGENTS.md instructions\nRead shared instructions" }] } },
    { type: "response_item", payload: { type: "message", role: "user",
      content: [{ type: "input_text",
                  text: "The following is the Codex agent history whose request action you are assessing." }] } },
    { type: "response_item", payload: { type: "message", role: "user",
      content: [{ type: "input_text", text: "Build the brew scheduler" }] } },
  ]);
  const convs = lib.codexConversations(root, 10);
  assert.strictEqual(convs.length, 1);
  assert.strictEqual(convs[0].agent, "codex");
  assert.strictEqual(convs[0].project, "officebrew");
  assert.strictEqual(convs[0].title, "Build the brew scheduler");
});

test("recentMemories reads non-deleted observations", () => {
  const dir = tmp();
  const db = path.join(dir, "engram.db");
  const sql = `CREATE TABLE observations (
      id INTEGER PRIMARY KEY, session_id TEXT, type TEXT, title TEXT,
      content TEXT, project TEXT, created_at TEXT, deleted_at TEXT);
    INSERT INTO observations (session_id,type,title,content,project,created_at)
      VALUES ('s','note','setup test','hello','llm-ground-zero','2026-06-10 10:00:00');
    INSERT INTO observations (session_id,type,title,content,project,created_at,deleted_at)
      VALUES ('s','note','deleted one','x','p','2026-06-10 11:00:00','2026-06-10 12:00:00');`;
  require("node:child_process").execFileSync("/usr/bin/sqlite3", [db, sql]);
  const mems = lib.recentMemories(db, 10);
  assert.strictEqual(mems.length, 1);
  assert.strictEqual(mems[0].title, "setup test");
  assert.strictEqual(mems[0].content, "hello");
});

test("recentMemories returns [] for missing db", () => {
  assert.deepStrictEqual(lib.recentMemories("/no/such/engram.db", 10), []);
});

test("advisorMemories includes stable join fields without deleted rows", () => {
  const dir = tmp();
  const db = path.join(dir, "engram.db");
  const sql = `CREATE TABLE observations (
      id INTEGER PRIMARY KEY, session_id TEXT, type TEXT, title TEXT,
      content TEXT, project TEXT, created_at TEXT, deleted_at TEXT);
    INSERT INTO observations (session_id,type,title,content,project,created_at)
      VALUES ('session-1','decision','pricing','see https://example.test','sample','2026-01-01 10:00:00');`;
  require("node:child_process").execFileSync("/usr/bin/sqlite3", [db, sql]);
  const rows = lib.advisorMemories(db, 10);
  assert.strictEqual(rows[0].id, 1);
  assert.strictEqual(rows[0].session_id, "session-1");
  assert.ok(rows[0].content.includes("https://example.test"));
});
