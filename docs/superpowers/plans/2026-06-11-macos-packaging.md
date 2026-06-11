# macOS Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the llm-ground-zero dashboard as a self-contained Electron .app distributed via a personal Homebrew tap, with MIT license, anonymous error logging, and a marketing-first README on a public GitHub repo.

**Architecture:** The Python dashboard server (`dashboard/`) is ported 1:1 to Node inside `app/` (Electron main process starts an HTTP server on 127.0.0.1:7788 and opens a BrowserWindow at it; the existing `index.html` carries over byte-for-byte). ccusage becomes an npm dependency; Engram's SQLite db is read via macOS's bundled `/usr/bin/sqlite3 -json` so there are zero native Node modules. All error paths write sanitized lines to `~/Library/Logs/llm-ground-zero/error.log`.

**Tech Stack:** Electron ^42, electron-builder ^26 (unsigned universal dmg), ccusage ^20 (npm dep), Node built-in `node:test`, GitHub Actions, Homebrew cask in `douglasvaz/homebrew-tap`.

**Spec:** `docs/superpowers/specs/2026-06-11-macos-packaging-design.md`

**Decisions made here (not in spec):** Engram DB path in the installed app comes from `ENGRAM_DATA_DIR` env var, falling back to `~/llm-ground-zero/data/engram.db` (the documented clone location) — an installed .app has no "repo dir". Port override via `LLM_GROUND_ZERO_PORT`. If 7788 is already taken (headless server running), the app just loads the existing URL.

---

## File structure

```
app/
  package.json          # npm package + electron-builder config
  main.js               # Electron main process (window + global error hooks)
  server.js             # HTTP server; also runnable headless: npm run serve
  lib.js                # parsers (port of dashboard/lib.py)
  log.js                # sanitizing error logger
  static/index.html     # moved from dashboard/static/, unchanged
  test/log.test.js
  test/lib.test.js
  test/server.test.js
.github/workflows/ci.yml
.github/workflows/release.yml
LICENSE
README.md               # rewritten
docs/assets/dashboard.png   # screenshot (user-supplied)
dashboard/              # DELETED in Task 9, after Node tests pass
```

---

### Task 1: Scaffold the app package and move the UI

**Files:**
- Create: `app/package.json`
- Move: `dashboard/static/index.html` → `app/static/index.html` (git mv, no edits)

- [ ] **Step 1: Create `app/package.json`**

```json
{
  "name": "llm-ground-zero",
  "productName": "LLM Ground Zero",
  "version": "0.1.0",
  "description": "Local dashboard for CLI coding agents — spend, tool usage, conversations, shared memory",
  "main": "main.js",
  "license": "MIT",
  "author": "Douglas Vas",
  "scripts": {
    "start": "electron .",
    "serve": "node server.js",
    "test": "node --test test/",
    "dist": "electron-builder --mac --universal"
  },
  "dependencies": {
    "ccusage": "^20.0.11"
  },
  "devDependencies": {
    "electron": "^42.4.0",
    "electron-builder": "^26.15.2"
  },
  "build": {
    "appId": "com.douglasvas.llm-ground-zero",
    "productName": "LLM Ground Zero",
    "directories": { "output": "dist" },
    "files": ["main.js", "server.js", "lib.js", "log.js", "static/**"],
    "asarUnpack": ["node_modules/ccusage/**"],
    "mac": {
      "category": "public.app-category.developer-tools",
      "identity": null,
      "target": [{ "target": "dmg", "arch": ["universal"] }],
      "artifactName": "llm-ground-zero-${version}-universal.dmg"
    }
  }
}
```

Notes for the engineer:
- `identity: null` = unsigned build (decided in spec).
- `asarUnpack` for ccusage: the server spawns ccusage's CLI as a child node
  process, and a plain node process cannot read files inside `app.asar`.
- electron-builder needs `files` to include everything `main.js` requires.

- [ ] **Step 2: Move the UI and install deps**

```bash
git mv dashboard/static/index.html app/static/index.html
cd app && npm install
```

Expected: `app/node_modules/` appears, `app/package-lock.json` created.

- [ ] **Step 3: Add `app/node_modules` and `app/dist` to .gitignore, plus `.idea/` (spec housekeeping)**

Append to `.gitignore`:

```
.idea/
app/node_modules/
app/dist/
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: scaffold Electron app package, move dashboard UI"
```

---

### Task 2: Sanitizing error logger (`app/log.js`)

**Files:**
- Create: `app/log.js`
- Test: `app/test/log.test.js`

The single chokepoint for the spec's anonymization rules: every write passes
through `sanitize()`; log content is built only from error name/message/stack
(never parsed data); home dir collapses to `~`.

- [ ] **Step 1: Write the failing tests**

`app/test/log.test.js`:

```js
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd app && node --test test/log.test.js`
Expected: FAIL — `Cannot find module '../log'`.

- [ ] **Step 3: Implement `app/log.js`**

```js
// Anonymous, shareable error log. Spec rule: log lines are built ONLY from
// error name/message/stack + static strings — never from parsed user data.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LOG_FILE = path.join(
  os.homedir(), "Library", "Logs", "llm-ground-zero", "error.log");
const MAX_BYTES = 1024 * 1024;

function sanitize(text) {
  return String(text).split(os.homedir()).join("~");
}

function logError(component, err, { file = LOG_FILE, version = "dev" } = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    version,
    component,
    error: sanitize((err && err.name) || "Error"),
    message: sanitize((err && err.message) || String(err)),
    stack: sanitize((err && err.stack) || ""),
  }) + "\n";
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, file + ".1");
    }
    fs.appendFileSync(file, line);
  } catch {
    // logging must never take the app down
  }
}

module.exports = { sanitize, logError, LOG_FILE };
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd app && node --test test/log.test.js` — Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add app/log.js app/test/log.test.js
git commit -m "feat: anonymous sanitizing error logger"
```

---

### Task 3: Claude parsers (`app/lib.js` part 1)

**Files:**
- Create: `app/lib.js`
- Test: `app/test/lib.test.js`

Port of `dashboard/lib.py` (`_iter_jsonl`, `_first_text`, `_is_noise`,
`claude_conversations`, `claude_tool_counts`). Behavior must match the Python
exactly — the tests below are direct ports of `dashboard/test_lib.py`.

- [ ] **Step 1: Write the failing tests**

`app/test/lib.test.js`:

```js
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
```

- [ ] **Step 2: Run, verify failure**

Run: `cd app && node --test test/lib.test.js`
Expected: FAIL — `Cannot find module '../lib'`.

- [ ] **Step 3: Implement `app/lib.js`**

```js
// Pure data-extraction functions. Filesystem paths in, plain objects out —
// unit-testable without HTTP or real agent installs. Port of dashboard/lib.py.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
}

function mtime(file) {
  try { return fs.statSync(file).mtimeMs / 1000; } catch { return 0; }
}

function byMtimeDesc(files) {
  return files
    .map((f) => [mtime(f), f])
    .sort((a, b) => b[0] - a[0])
    .map(([, f]) => f);
}

function* iterJsonl(file) {
  let data;
  try { data = fs.readFileSync(file, "utf8"); } catch { return; }
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { continue; }
  }
}

// Extract displayable user text from a Claude message content field.
function firstText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "text") {
        return block.text || "";
      }
    }
  }
  return "";
}

// Command wrappers, env context, tool results — not a real prompt.
// (Codex gotcha: env context arrives wrapped as a user message starting "<".)
function isNoise(text) {
  const t = text.trim();
  return !t || t.startsWith("<") || t.startsWith("Caveat:");
}

function claudeConversations(projectsRoot, limit = 20) {
  const files = byMtimeDesc(
    walkFiles(projectsRoot).filter((f) => f.endsWith(".jsonl")));
  const convs = [];
  for (const file of files.slice(0, limit * 3)) { // over-scan: some sessions have no real prompt
    let title = null, cwd = "", ts = "";
    for (const row of iterJsonl(file)) {
      if (row.type !== "user") continue;
      const text = firstText((row.message || {}).content);
      if (isNoise(text)) continue;
      title = text; cwd = row.cwd || ""; ts = row.timestamp || "";
      break;
    }
    if (title) {
      convs.push({
        agent: "claude",
        project: cwd ? path.basename(cwd) : "?",
        title: title.trim().slice(0, 160),
        time: ts,
        mtime: mtime(file),
      });
    }
    if (convs.length >= limit) break;
  }
  return convs;
}

function claudeToolCounts(projectsRoot, days = 30) {
  const cutoff = Date.now() / 1000 - days * 86400;
  const counts = {};
  for (const file of walkFiles(projectsRoot)) {
    if (!file.endsWith(".jsonl") || mtime(file) < cutoff) continue;
    for (const row of iterJsonl(file)) {
      if (row.type !== "assistant") continue;
      const content = (row.message || {}).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block && typeof block === "object" && block.type === "tool_use") {
          const name = block.name || "?";
          counts[name] = (counts[name] || 0) + 1;
        }
      }
    }
  }
  return counts;
}

module.exports = {
  walkFiles, iterJsonl, firstText, isNoise,
  claudeConversations, claudeToolCounts,
};
```

(`execFileSync` import is used in Task 5; harmless now.)

- [ ] **Step 4: Run tests, verify pass**

Run: `cd app && node --test test/lib.test.js` — Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib.js app/test/lib.test.js
git commit -m "feat: port Claude session parsers to Node"
```

---

### Task 4: Codex parser (`app/lib.js` part 2)

**Files:**
- Modify: `app/lib.js`
- Test: `app/test/lib.test.js` (append)

- [ ] **Step 1: Append the failing test to `app/test/lib.test.js`**

```js
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
      content: [{ type: "input_text", text: "Build the brew scheduler" }] } },
  ]);
  const convs = lib.codexConversations(root, 10);
  assert.strictEqual(convs.length, 1);
  assert.strictEqual(convs[0].agent, "codex");
  assert.strictEqual(convs[0].project, "officebrew");
  assert.strictEqual(convs[0].title, "Build the brew scheduler");
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd app && node --test test/lib.test.js`
Expected: FAIL — `lib.codexConversations is not a function`.

- [ ] **Step 3: Implement `codexConversations` in `app/lib.js`** (before `module.exports`, and add it to the exports)

```js
function codexConversations(sessionsRoot, limit = 20) {
  const files = byMtimeDesc(walkFiles(sessionsRoot).filter((f) =>
    path.basename(f).startsWith("rollout-") && f.endsWith(".jsonl")));
  const convs = [];
  for (const file of files.slice(0, limit * 3)) {
    let cwd = "", ts = "", title = null;
    for (const row of iterJsonl(file)) {
      const payload = row.payload || {};
      if (row.type === "session_meta") {
        cwd = payload.cwd || "";
        ts = payload.timestamp || row.timestamp || "";
      } else if (payload.type === "message" && payload.role === "user") {
        const text = (payload.content || [])
          .filter((b) => b && typeof b === "object")
          .map((b) => b.text || "")
          .join(" ");
        if (isNoise(text)) continue;
        title = text;
        break;
      }
    }
    if (title) {
      convs.push({
        agent: "codex",
        project: cwd ? path.basename(cwd) : "?",
        title: title.trim().slice(0, 160),
        time: ts,
        mtime: mtime(file),
      });
    }
    if (convs.length >= limit) break;
  }
  return convs;
}
```

- [ ] **Step 4: Run tests, verify all pass** — `cd app && node --test test/lib.test.js`

- [ ] **Step 5: Commit**

```bash
git add app/lib.js app/test/lib.test.js
git commit -m "feat: port Codex session parser to Node"
```

---

### Task 5: Engram memories via sqlite3 CLI (`app/lib.js` part 3)

**Files:**
- Modify: `app/lib.js`
- Test: `app/test/lib.test.js` (append)

Reads the db with macOS's bundled `/usr/bin/sqlite3 -json` — no native Node
modules. Read-only; returns `[]` if the db is missing or sqlite3 errors.

- [ ] **Step 1: Append the failing test**

```js
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
```

- [ ] **Step 2: Run, verify failure** — `lib.recentMemories is not a function`.

- [ ] **Step 3: Implement `recentMemories` in `app/lib.js`** (add to exports)

```js
// Latest non-deleted Engram observations via the macOS-bundled sqlite3 CLI.
// Read-only; safe if DB missing. Caller logs errors — but note any error
// thrown here may contain the db path, so callers must sanitize (log.js does).
function recentMemories(dbPath, limit = 15) {
  if (!fs.existsSync(dbPath)) return [];
  const sql = `SELECT type, title, substr(content,1,240) AS content,
      coalesce(project,'') AS project, created_at
    FROM observations WHERE deleted_at IS NULL
    ORDER BY created_at DESC LIMIT ${Number(limit)};`;
  let out;
  try {
    out = execFileSync("/usr/bin/sqlite3",
      ["-json", "-readonly", dbPath, sql],
      { encoding: "utf8", timeout: 10000 });
  } catch {
    return [];
  }
  try { return JSON.parse(out); } catch { return []; } // empty result = ""
}
```

- [ ] **Step 4: Run full suite** — `cd app && npm test` — Expected: all pass (log + lib).

- [ ] **Step 5: Commit**

```bash
git add app/lib.js app/test/lib.test.js
git commit -m "feat: read Engram memories via bundled sqlite3 CLI"
```

---

### Task 6: HTTP server (`app/server.js`)

**Files:**
- Create: `app/server.js`
- Test: `app/test/server.test.js`

Same contract as `dashboard/server.py`: four `/api/*` JSON endpoints, 60s
cache, per-endpoint degradation (`{"error": ...}`), static `index.html`,
binds 127.0.0.1 only. New: every catch block also calls `logError`.

- [ ] **Step 1: Write the failing test**

`app/test/server.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { startServer } = require("../server");

test("server serves index.html and degrading API endpoints", async () => {
  const server = await startServer(0); // ephemeral port
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const html = await fetch(base + "/").then((r) => r.text());
    assert.ok(html.includes("llm-"));

    for (const ep of ["tools", "conversations", "memories"]) {
      const res = await fetch(`${base}/api/${ep}`);
      assert.strictEqual(res.headers.get("content-type"), "application/json");
      const body = await res.json();
      // real or empty data, or a per-panel error — never a crash
      assert.ok(typeof body === "object" && body !== null);
    }

    const missing = await fetch(base + "/nope");
    assert.strictEqual(missing.status, 404);
  } finally {
    server.close();
  }
});
```

(`/api/usage` is excluded: it shells out to ccusage and can take ~minutes on
real logs; it shares the same `guard()` code path as the others.)

- [ ] **Step 2: Run, verify failure** — `Cannot find module '../server'`.

- [ ] **Step 3: Implement `app/server.js`**

```js
// Dashboard HTTP server. Also runs headless: `npm run serve` (no Electron).
// Each endpoint degrades independently — an error in one data source returns
// {"error": ...} for that panel (and a sanitized line in the error log)
// instead of failing the page.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const lib = require("./lib");
const { logError, sanitize } = require("./log");

const HOME = os.homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const CODEX_SESSIONS = path.join(HOME, ".codex", "sessions");
const ENGRAM_DB = process.env.ENGRAM_DATA_DIR
  ? path.join(process.env.ENGRAM_DATA_DIR, "engram.db")
  : path.join(HOME, "llm-ground-zero", "data", "engram.db");
const STATIC_DIR = path.join(__dirname, "static");
const VERSION = require("./package.json").version;
// ccusage ships a node CLI; spawn it with our own runtime. In a packaged
// Electron app the binary doubles as node via ELECTRON_RUN_AS_NODE, and the
// asar-unpacked copy is the one a plain node process can actually read.
const CCUSAGE_CLI = path
  .join(__dirname, "node_modules", "ccusage", "dist", "cli.js")
  .replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);

const cache = new Map();
const CACHE_TTL = 60_000;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

function ccusageDaily() {
  return new Promise((resolve) => {
    execFile(process.execPath, [CCUSAGE_CLI, "daily", "--json"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        logError("usage", err, { version: VERSION });
        resolve({ error: "ccusage failed: " + sanitize(String(stderr)).slice(0, 300) });
      } else {
        try { resolve(JSON.parse(stdout)); }
        catch (e) {
          logError("usage", e, { version: VERSION });
          resolve({ error: "ccusage output was not JSON" });
        }
      }
    });
  });
}

function guard(component, fn) {
  return async () => {
    try { return await cached(component, fn); }
    catch (e) {
      logError(component, e, { version: VERSION });
      return { error: sanitize(e.message || String(e)).slice(0, 300) };
    }
  };
}

const ROUTES = {
  "/api/usage": guard("usage", ccusageDaily),
  "/api/tools": guard("tools",
    async () => ({ days: 30, counts: lib.claudeToolCounts(CLAUDE_PROJECTS, 30) })),
  "/api/conversations": guard("conversations", async () => {
    const convs = lib.claudeConversations(CLAUDE_PROJECTS, 15)
      .concat(lib.codexConversations(CODEX_SESSIONS, 15));
    convs.sort((a, b) => b.mtime - a.mtime);
    return convs.slice(0, 20);
  }),
  "/api/memories": guard("memories",
    async () => lib.recentMemories(ENGRAM_DB, 15)),
};

function startServer(port = 7788) {
  const server = http.createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];
    const route = ROUTES[url];
    if (route) {
      const body = JSON.stringify(await route());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    } else if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(STATIC_DIR, "index.html")));
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { startServer };

if (require.main === module) {
  const port = Number(process.argv[2] || process.env.LLM_GROUND_ZERO_PORT || 7788);
  startServer(port).then(() =>
    console.log(`llm-ground-zero dashboard → http://localhost:${port}`));
}
```

- [ ] **Step 4: Run tests** — `cd app && npm test` — Expected: all pass.

- [ ] **Step 5: Manual parity check against the Python server**

```bash
cd app && node server.js 7789 &
sleep 1
curl -s localhost:7789/api/tools | head -c 200; echo
curl -s localhost:7789/api/conversations | head -c 300; echo
curl -s localhost:7789/api/memories | head -c 300; echo
kill %1
```

Expected: real data from `~/.claude/projects` etc., shaped like the Python
server's output (compare with a quick `./dashboard/serve.sh` if unsure).

- [ ] **Step 6: Commit**

```bash
git add app/server.js app/test/server.test.js
git commit -m "feat: port dashboard server to Node with sanitized error logging"
```

---

### Task 7: Electron main process (`app/main.js`)

**Files:**
- Create: `app/main.js`

- [ ] **Step 1: Implement `app/main.js`**

```js
const { app, BrowserWindow } = require("electron");
const { startServer } = require("./server");
const { logError } = require("./log");

const VERSION = require("./package.json").version;
process.on("uncaughtException", (e) => logError("electron", e, { version: VERSION }));
process.on("unhandledRejection", (e) => logError("electron", e, { version: VERSION }));

const PORT = Number(process.env.LLM_GROUND_ZERO_PORT || 7788);

app.whenReady().then(async () => {
  try {
    await startServer(PORT);
  } catch (e) {
    if (e.code !== "EADDRINUSE") throw e; // headless server already running → just attach
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "LLM Ground Zero",
    backgroundColor: "#0d1117",
  });
  win.loadURL(`http://127.0.0.1:${PORT}`);
});

app.on("window-all-closed", () => app.quit());
```

- [ ] **Step 2: Run the app in dev mode and verify**

Run: `cd app && npm start`
Expected: a window titled "LLM Ground Zero" opens showing the dashboard with
live data (same panels as the screenshot). Close it; the process exits.

- [ ] **Step 3: Commit**

```bash
git add app/main.js
git commit -m "feat: Electron shell for the dashboard"
```

---

### Task 8: Build the dmg locally

**Files:**
- None new (uses the `build` config from Task 1)

- [ ] **Step 1: Build**

Run: `cd app && npm run dist`
Expected: `app/dist/llm-ground-zero-0.1.0-universal.dmg` exists. Warnings
about "skipped macOS code signing" are expected (unsigned by design).

- [ ] **Step 2: Smoke-test the packaged app**

```bash
hdiutil attach app/dist/llm-ground-zero-0.1.0-universal.dmg
cp -R "/Volumes/LLM Ground Zero"*/LLM\ Ground\ Zero.app /tmp/
hdiutil detach "/Volumes/LLM Ground Zero"* 
open /tmp/LLM\ Ground\ Zero.app
```

Expected: dashboard window opens with live data — in particular the spend
cards (proves the asar-unpacked ccusage spawn works in the packaged app).
Then `rm -rf /tmp/LLM\ Ground\ Zero.app`.

- [ ] **Step 3: Commit anything that needed fixing; otherwise no commit.**

---

### Task 9: Delete the Python dashboard

**Files:**
- Delete: `dashboard/` (server.py, lib.py, test_lib.py, serve.sh, `__pycache__`)
- Modify: any references — check with `grep -rn "dashboard/" README.md setup.sh agents/ context/`

- [ ] **Step 1: Verify the Node suite covers the Python tests** (it does — Tasks 2–6 ported every test), then delete

```bash
git rm -r dashboard
grep -rn "dashboard" README.md setup.sh agents/AGENTS.md || true
```

Update any hits: `./dashboard/serve.sh` references become
`cd app && npm run serve` (README gets fully rewritten in Task 11 anyway).

- [ ] **Step 2: Run full test suite** — `cd app && npm test` — all pass.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: remove Python dashboard, superseded by Node port"
```

---

### Task 10: LICENSE

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Write `LICENSE`** — standard MIT text, exactly:

```
MIT License

Copyright (c) 2026 Douglas Vas

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Note: copyright holder is "Douglas Vas" (user's legal name — the "s" is not
a typo, despite the `douglasvaz` username).

- [ ] **Step 2: Commit** — `git add LICENSE && git commit -m "docs: MIT license"`

---

### Task 11: README rewrite + screenshot

**Files:**
- Rewrite: `README.md`
- Create: `docs/assets/dashboard.png` (user-supplied — ask, or capture from the running app via screenshot)

- [ ] **Step 1: Get the screenshot in place**

Ask the user to save their dashboard screenshot as
`docs/assets/dashboard.png`, or run the app and capture it. Don't block: if
unavailable, leave the image tag in and note it for the user.

- [ ] **Step 2: Rewrite `README.md`**

Structure (marketing-first, personal voice — final wording may be polished,
structure is fixed; preserve the current README's per-agent setup detail by
moving it to the bottom under "Per-agent reference"):

```markdown
# llm-ground-zero

> One memory, every coding agent. A shared brain + usage dashboard for
> Claude Code, Codex CLI, Gemini CLI and friends — on subscription plans,
> with no API keys.

![Dashboard](docs/assets/dashboard.png)

I built this because I kept switching between CLI coding agents mid-task —
Claude Code for one thing, Codex for another — and every switch meant
starting from zero. Each agent had amnesia about decisions the previous one
made. And since I'm on subscription plans, I had no idea what my usage
would actually cost in API terms. If you run more than one coding agent,
this can be useful to you too.

## What you get

- **A menu-launchable macOS app** showing spend (API-equivalent), tool
  usage, recent conversations across agents, and your agents' shared memory
- **Shared memory between agents** — switch from Claude Code to Codex
  mid-task and it picks up where the other left off (file handoffs +
  searchable Engram memory over MCP)
- **No API keys anywhere** — built for subscription plans

## Install

The app:

    brew install --cask --no-quarantine douglasvaz/tap/llm-ground-zero

(`--no-quarantine` because the app is unsigned — it's open source, read it!)

The agent wiring (shared memory, AGENTS.md, usage tools):

    git clone https://github.com/douglasvaz/llm-ground-zero ~/llm-ground-zero
    cd ~/llm-ground-zero && ./setup.sh

## How it works
[two-tier memory explanation, condensed from current README]

## Troubleshooting
If a panel shows an error, check `~/Library/Logs/llm-ground-zero/error.log`.
It contains only anonymized error data (no conversation content, usernames,
or paths) — safe to attach to a GitHub issue.

## Per-agent reference
[current README's Claude Code / Codex / Gemini sections, verbatim]

## License
MIT — © Douglas Vas
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/assets/dashboard.png
git commit -m "docs: marketing-first README with app install path"
```

---

### Task 12: GitHub Actions (CI + release)

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write `ci.yml`**

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
        working-directory: app
      - run: npm test
        working-directory: app
```

(macos-latest because the memories test shells out to `/usr/bin/sqlite3`.)

- [ ] **Step 2: Write `release.yml`**

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
jobs:
  build:
    runs-on: macos-latest
    env:
      CSC_IDENTITY_AUTO_DISCOVERY: "false"   # unsigned by design
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
        working-directory: app
      - run: npm test
        working-directory: app
      - run: npm run dist
        working-directory: app
      - name: checksum
        run: shasum -a 256 app/dist/*.dmg | tee app/dist/SHA256SUMS
      - name: release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            app/dist/*.dmg app/dist/SHA256SUMS \
            --title "${GITHUB_REF_NAME}" --generate-notes
```

- [ ] **Step 3: Commit**

```bash
git add .github && git commit -m "ci: test workflow + tagged dmg releases"
```

---

### Task 13: Create the GitHub repo and push

- [ ] **Step 1: Confirm the GitHub username** (cask URLs depend on it)

Run: `gh api user --jq .login` — Expected: `douglasvaz`. If different,
substitute everywhere below and in Task 11's README + Task 15's cask.

- [ ] **Step 2: Create the public repo and push**

```bash
cd ~/llm-ground-zero
gh repo create llm-ground-zero --public --source . --push \
  --description "One memory, every coding agent — shared brain + usage dashboard for Claude Code, Codex, Gemini (subscription plans, no API keys)"
gh repo edit --add-topic claude-code --add-topic codex --add-topic mcp \
  --add-topic memory --add-topic dashboard --add-topic electron --add-topic macos
```

Expected: repo visible at github.com/douglasvaz/llm-ground-zero with README
rendering, CI workflow green (check `gh run watch`).

---

### Task 14: Tag v0.1.0 and verify the release

- [ ] **Step 1: Tag and push**

```bash
git tag v0.1.0 && git push origin v0.1.0
gh run watch   # release workflow
```

Expected: workflow succeeds; `gh release view v0.1.0` shows the dmg +
SHA256SUMS assets.

- [ ] **Step 2: Record the sha256** — `gh release download v0.1.0 -p SHA256SUMS -O -` — needed for the cask.

---

### Task 15: Homebrew tap + cask

**Files (new repo `~/homebrew-tap`):**
- Create: `Casks/llm-ground-zero.rb`

- [ ] **Step 1: Create the tap repo**

```bash
mkdir -p ~/homebrew-tap/Casks && cd ~/homebrew-tap && git init -b main
```

- [ ] **Step 2: Write `Casks/llm-ground-zero.rb`** (substitute the real sha256 from Task 14)

```ruby
cask "llm-ground-zero" do
  version "0.1.0"
  sha256 "REPLACE_WITH_SHA256_FROM_TASK_14"

  url "https://github.com/douglasvaz/llm-ground-zero/releases/download/v#{version}/llm-ground-zero-#{version}-universal.dmg"
  name "LLM Ground Zero"
  desc "Shared memory and usage dashboard for CLI coding agents"
  homepage "https://github.com/douglasvaz/llm-ground-zero"

  app "LLM Ground Zero.app"

  zap trash: [
    "~/Library/Logs/llm-ground-zero",
    "~/Library/Application Support/LLM Ground Zero",
  ]

  caveats <<~EOS
    This app is not code-signed. If macOS blocks it, reinstall with:
      brew reinstall --cask --no-quarantine llm-ground-zero

    The dashboard reads data set up by the llm-ground-zero CLI tooling.
    For shared agent memory and usage tracking, also run:
      git clone https://github.com/douglasvaz/llm-ground-zero ~/llm-ground-zero
      cd ~/llm-ground-zero && ./setup.sh
  EOS
end
```

- [ ] **Step 3: Validate and push**

```bash
cd ~/homebrew-tap
brew style Casks/llm-ground-zero.rb
git add -A && git commit -m "cask: llm-ground-zero 0.1.0"
gh repo create homebrew-tap --public --source . --push \
  --description "Homebrew tap for douglasvaz's tools"
```

Expected: `brew style` passes (fix offenses if any).

- [ ] **Step 4: End-to-end install test**

```bash
brew tap douglasvaz/tap
brew install --cask --no-quarantine llm-ground-zero
open -a "LLM Ground Zero"
```

Expected: app installs to /Applications and opens with live data. Then
optionally `brew uninstall --cask llm-ground-zero` (keep it if you want).

---

### Task 16: Wrap-up

- [ ] **Step 1: Update `context/llm-ground-zero/handoff.md`** — new current
  state (Electron app, repo public, tap live), decisions (sqlite3 CLI over
  native modules, asar-unpack for ccusage, unsigned + --no-quarantine), next
  steps (signing when traction, homebrew/cask graduation).
- [ ] **Step 2: Save key decisions to Engram** (`mem_save`): sqlite3-CLI
  trick, ELECTRON_RUN_AS_NODE + asarUnpack gotcha for spawning bundled CLIs,
  legal name for LICENSE.
- [ ] **Step 3: Final commit & push** — `git push`.

---

## Self-review notes

- Spec coverage: app architecture (T1–T7), dependency strategy (T1, T5, T6),
  tests (T2–T6), build/release (T8, T12, T14), Homebrew (T15), LICENSE (T10),
  README + screenshot + housekeeping (T1 step 3, T11, T13), error log (T2,
  wired in T6/T7), Python deletion gated on passing ported tests (T9). ✓
- The UI is moved, never edited (T1). ✓
- Types/signatures consistent across tasks: `startServer(port) → Promise<Server>`,
  `logError(component, err, {file, version})`, lib functions return the same
  shapes the existing index.html consumes (`agent/project/title/time/mtime`,
  `{days, counts}`, memory rows with `type/title/content/project/created_at`). ✓
```
