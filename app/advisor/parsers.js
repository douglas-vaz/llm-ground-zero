"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_EVIDENCE = 240;

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object")
    .map((block) => block.text || block.content || "")
    .filter((value) => typeof value === "string")
    .join(" ");
}

function excerpt(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_EVIDENCE);
}

function isNoise(text) {
  const value = String(text || "").trim();
  return !value
    || value.startsWith("<")
    || value.startsWith("Caveat:")
    || value.startsWith("# AGENTS.md instructions")
    || value.startsWith("# CLAUDE.md instructions")
    || value.startsWith("# GEMINI.md instructions")
    || value.startsWith("The following is the Codex agent history");
}

function normalizeTool(name) {
  return String(name || "unknown").replace(/^mcp__/, "").toLowerCase();
}

function commandFromInput(input) {
  const parsed = safeJson(input);
  return String(parsed.command || parsed.cmd || parsed.script || "");
}

function fileFromInput(input) {
  const parsed = safeJson(input);
  return String(parsed.file_path || parsed.path || parsed.file || "");
}

function commandCategory(command, tool = "") {
  const value = `${tool} ${command}`.toLowerCase();
  if (/mem_save/.test(value)) return "memory_save";
  if (/mem_search|mem_context/.test(value)) return "memory_recall";
  if (/\bgh\s+pr\s+create\b/.test(value)) return "pull_request";
  if (/\bgit\s+commit\b/.test(value)) return "commit";
  if (/\bgit\s+(revert|restore)\b|\bgit\s+checkout\s+--/.test(value)) return "revert";
  if (/\b(npm|pnpm|yarn|cargo|go|pytest|python[^ ]* -m pytest)\b[^\n]*(test|check)|\b(test|pytest)\b/.test(value)) return "test";
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?build\b|\bcargo\s+build\b|\bgo\s+build\b/.test(value)) return "build";
  if (/\b(release|deploy|publish)\b/.test(value)) return "release";
  if (/\b(read|view|open)\b/.test(value) || /read|view_image/.test(tool)) return "read";
  if (/apply_patch|\b(edit|write|create)\b/.test(value)) return "write";
  return "other";
}

function failedResult(value, explicit = false) {
  if (explicit) return true;
  const text = String(value || "");
  return /(?:process )?exited with (?:code|status) [1-9]\d*\b|\bexit code [1-9]\d*\b|\bcommand failed\b|^error:/im.test(text);
}

function sessionObject(agent, sourceId, cwd, startedAt, events, sourceFile) {
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const prompt = events.find((event) => event.kind === "prompt" && !isNoise(event.text));
  const last = events.at(-1);
  return {
    id: `${agent}-${hash(sourceId)}`,
    sourceId,
    usageKey: sourceId,
    agent,
    project: cwd ? path.basename(cwd) : "?",
    cwd,
    sourceFile,
    startedAt: startedAt || events[0]?.at || "",
    lastActivityAt: last?.at || startedAt || "",
    title: excerpt(prompt?.text || "Untitled session").slice(0, 160),
    events,
  };
}

function parseClaudeRows(rows, sourceFile = "claude.jsonl") {
  const events = [];
  const pending = new Map();
  let sourceId = "";
  let cwd = "";
  let startedAt = "";
  for (const row of rows) {
    sourceId = sourceId || row.sessionId || path.basename(sourceFile, ".jsonl");
    cwd = cwd || row.cwd || "";
    startedAt = startedAt || row.timestamp || "";
    const at = row.timestamp || "";
    const content = row.message?.content;
    if (row.type === "user" && typeof content === "string" && !isNoise(content)) {
      events.push({ id: hash(`${sourceId}:${events.length}`), at, kind: "prompt", text: excerpt(content) });
    }
    if (row.type === "user" && Array.isArray(content)) {
      const promptText = textFromContent(content.filter((block) => block.type === "text"));
      if (!isNoise(promptText)) events.push({ id: hash(`${sourceId}:${events.length}`), at, kind: "prompt", text: excerpt(promptText) });
      for (const block of content.filter((item) => item?.type === "tool_result")) {
        const call = pending.get(block.tool_use_id) || {};
        const output = textFromContent(block.content) || String(block.content || "");
        const status = failedResult(output, block.is_error === true) ? "failure" : "success";
        events.push({
          id: hash(`${sourceId}:${events.length}`), at, kind: "tool_result",
          tool: call.tool || "unknown", category: call.category || "other",
          file: call.file || "", status, text: excerpt(output), callId: block.tool_use_id || "",
        });
      }
    }
    if (row.type === "assistant" && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "tool_use") {
          const tool = normalizeTool(block.name);
          const command = commandFromInput(block.input);
          pending.set(block.id, { tool, category: commandCategory(command, tool), file: fileFromInput(block.input) });
        } else if (block?.type === "text" && excerpt(block.text)) {
          events.push({ id: hash(`${sourceId}:${events.length}`), at, kind: "assistant", text: excerpt(block.text) });
        }
      }
    }
  }
  return sessionObject("claude", sourceId || path.basename(sourceFile, ".jsonl"), cwd, startedAt, events, sourceFile);
}

function parseCodexRows(rows, sourceFile = "rollout.jsonl") {
  const events = [];
  const pending = new Map();
  let sourceId = path.basename(sourceFile, ".jsonl");
  let cwd = "";
  let startedAt = "";
  for (const row of rows) {
    const payload = row.payload || {};
    const at = row.timestamp || payload.timestamp || "";
    if (row.type === "session_meta") {
      sourceId = payload.id || sourceId;
      cwd = payload.cwd || cwd;
      startedAt = payload.timestamp || at || startedAt;
      continue;
    }
    if (payload.type === "message") {
      const text = textFromContent(payload.content);
      if (payload.role === "user" && !isNoise(text)) {
        events.push({ id: hash(`${sourceId}:${events.length}`), at, kind: "prompt", text: excerpt(text) });
      } else if (payload.role === "assistant" && excerpt(text)) {
        events.push({ id: hash(`${sourceId}:${events.length}`), at, kind: "assistant", text: excerpt(text) });
      }
    } else if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      const callId = payload.call_id || payload.id || `call-${events.length}`;
      const tool = normalizeTool(payload.name);
      const command = commandFromInput(payload.arguments || payload.input);
      pending.set(callId, { tool, category: commandCategory(command, tool), file: fileFromInput(payload.arguments || payload.input) });
    } else if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const callId = payload.call_id || payload.id || "";
      const call = pending.get(callId) || {};
      const output = textFromContent(payload.output) || String(payload.output || "");
      events.push({
        id: hash(`${sourceId}:${events.length}`), at, kind: "tool_result",
        tool: call.tool || "unknown", category: call.category || "other", file: call.file || "",
        status: failedResult(output, payload.is_error === true) ? "failure" : "success",
        text: excerpt(output), callId,
      });
    }
  }
  const session = sessionObject("codex", sourceId, cwd, startedAt, events, sourceFile);
  session.usageKey = path.basename(sourceFile, ".jsonl").replace(/^rollout-/, "rollout-");
  return session;
}

function readJsonl(file) {
  let content;
  try { content = fs.readFileSync(file, "utf8"); } catch { return []; }
  return content.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function walk(root, out = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else if (entry.name.endsWith(".jsonl")) out.push(file);
  }
  return out;
}

function loadSessions({ claudeRoot, codexRoot, sinceMs = 0, maxSessions = 300, maxFileBytes = 20 * 1024 * 1024 }) {
  const warnings = [];
  const candidates = [
    ...walk(claudeRoot).map((file) => ({ agent: "claude", file })),
    ...walk(codexRoot).filter((file) => path.basename(file).startsWith("rollout-")).map((file) => ({ agent: "codex", file })),
  ].flatMap((item) => {
    try { return [{ ...item, stat: fs.statSync(item.file) }]; } catch { return []; }
  }).filter((item) => item.stat.mtimeMs >= sinceMs)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, maxSessions);
  const sessions = [];
  for (const item of candidates) {
    if (item.stat.size > maxFileBytes) {
      warnings.push({ type: "file_too_large", agent: item.agent });
      continue;
    }
    const rows = readJsonl(item.file);
    const parsed = item.agent === "claude" ? parseClaudeRows(rows, item.file) : parseCodexRows(rows, item.file);
    if (parsed.events.length) sessions.push(parsed);
  }
  return { sessions, warnings, scanned: candidates.length };
}

module.exports = {
  hash, excerpt, isNoise, normalizeTool, commandCategory, failedResult,
  parseClaudeRows, parseCodexRows, loadSessions,
};
