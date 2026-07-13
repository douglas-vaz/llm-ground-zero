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
  return !t
    || t.startsWith("<")
    || t.startsWith("Caveat:")
    || t.startsWith("# AGENTS.md instructions")
    || t.startsWith("# CLAUDE.md instructions")
    || t.startsWith("# GEMINI.md instructions")
    || t.startsWith("The following is the Codex agent history");
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

function advisorMemories(dbPath, limit = 100) {
  if (!fs.existsSync(dbPath)) return [];
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const sql = `SELECT id, coalesce(session_id,'') AS session_id, type, title,
      substr(content,1,2000) AS content, coalesce(project,'') AS project, created_at
    FROM observations WHERE deleted_at IS NULL
    ORDER BY created_at DESC LIMIT ${safeLimit};`;
  try {
    const out = execFileSync("/usr/bin/sqlite3", ["-json", "-readonly", dbPath, sql],
      { encoding: "utf8", timeout: 10000 });
    return JSON.parse(out || "[]");
  } catch { return []; }
}

module.exports = {
  walkFiles, iterJsonl, firstText, isNoise,
  claudeConversations, claudeToolCounts,
  codexConversations,
  recentMemories, advisorMemories,
};
