const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sanitize, logError } = require("../log");

test("sanitize collapses home directory to ~", () => {
  const home = os.homedir();
  assert.strictEqual(
    sanitize(`Error: ENOENT at ${home}/.claude/projects/x.jsonl`),
    "Error: ENOENT at ~/.claude/projects/x.jsonl");
  assert.strictEqual(sanitize(`${home}/a and ${home}/b`), "~/a and ~/b");
});

test("logError writes a sanitized JSON line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-log-"));
  const file = path.join(dir, "error.log");
  const err = new Error(`boom in ${os.homedir()}/.codex/sessions`);
  logError("conversations", err, { file, version: "0.1.0" });
  const line = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.strictEqual(line.component, "conversations");
  assert.strictEqual(line.version, "0.1.0");
  assert.ok(line.message.includes("~/.codex/sessions"));
  assert.ok(!JSON.stringify(line).includes(os.homedir()));
  assert.ok(line.ts.match(/^\d{4}-\d{2}-\d{2}T/));
});

test("logError rotates at 1MB", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-rot-"));
  const file = path.join(dir, "error.log");
  fs.writeFileSync(file, "x".repeat(1024 * 1024 + 1));
  logError("server", new Error("after rotation"), { file });
  assert.ok(fs.existsSync(file + ".1"));
  assert.ok(fs.statSync(file).size < 1024);
});

test("logError never throws (unwritable path)", () => {
  logError("server", new Error("x"), { file: "/nonexistent-root-dir/e.log" });
});
