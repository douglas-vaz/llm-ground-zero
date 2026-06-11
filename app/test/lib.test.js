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
