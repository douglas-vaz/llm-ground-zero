"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const MIN_VERSION = "0.31.0";
const PROFILE = "llm-ground-zero";
const PORT = 8791;
const TARGETS = new Set(["claude", "codex"]);
const MODES = new Set(["cache", "token"]);

function workspaceDir() {
  return process.env.LLM_GROUND_ZERO_HEADROOM_WORKSPACE
    || path.join(os.homedir(), "Library", "Application Support", "LLM Ground Zero", "headroom");
}

function proxyPort() {
  const value = Number(process.env.LLM_GROUND_ZERO_HEADROOM_PORT);
  return Number.isInteger(value) && value > 0 ? value : PORT;
}

function fixture() {
  const file = process.env.LLM_GROUND_ZERO_HEADROOM_FIXTURE;
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function candidates() {
  return [
    process.env.LLM_GROUND_ZERO_HEADROOM_BIN,
    path.join(os.homedir(), ".local", "bin", "headroom"),
    "/opt/homebrew/bin/headroom",
    "/usr/local/bin/headroom",
    "headroom",
  ].filter(Boolean);
}

function uvCandidates() {
  return [
    process.env.LLM_GROUND_ZERO_UV_BIN,
    path.join(os.homedir(), ".local", "bin", "uv"),
    "/opt/homebrew/bin/uv",
    "/usr/local/bin/uv",
    "uv",
  ].filter(Boolean);
}

function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      env: { ...process.env, HEADROOM_WORKSPACE_DIR: workspaceDir(), HEADROOM_TELEMETRY: "off" },
      timeout: options.timeout || 30_000,
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: String(stderr || "").slice(0, 500) }));
      else resolve(String(stdout || ""));
    });
  });
}

function versionParts(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(value, minimum = MIN_VERSION) {
  const a = versionParts(value); const b = versionParts(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

async function locate() {
  const data = fixture();
  if (data?.status) return { binary: "fixture", version: data.status.version || MIN_VERSION, compatible: true };
  for (const binary of candidates()) {
    try {
      const output = await run(binary, ["--version"], { timeout: 5000 });
      const match = output.match(/\d+\.\d+\.\d+/);
      if (match) return { binary, version: match[0], compatible: versionAtLeast(match[0]) };
    } catch { /* try next location */ }
  }
  return { binary: null, version: null, compatible: false };
}

async function locateUv() {
  for (const binary of uvCandidates()) {
    try {
      const output = await run(binary, ["--version"], { timeout: 5000 });
      if (/\buv\s+\d+\.\d+/i.test(output)) return { binary, version: output.match(/\d+\.\d+\.\d+/)?.[0] || null };
    } catch { /* try next location */ }
  }
  return { binary: null, version: null };
}

function readManifest() {
  const file = path.join(workspaceDir(), "deploy", PROFILE, "manifest.json");
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      targets: Array.isArray(value.targets) ? value.targets.filter((item) => TARGETS.has(item)) : [],
      mode: MODES.has(value.proxy_mode) ? value.proxy_mode : "cache",
      port: Number(value.port) || proxyPort(),
    };
  } catch { return null; }
}

async function proxyJson(route, timeout = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort()}${route}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Headroom returned HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function proxyHealthy() {
  try { return (await proxyJson("/health")).status === "healthy"; } catch { return false; }
}

// Bounded wait for the persistent proxy to come up after `install apply`.
async function waitForHealthy() {
  const budget = Number(process.env.LLM_GROUND_ZERO_HEADROOM_HEALTH_WAIT_MS ?? 12_000);
  const deadline = Date.now() + Math.max(0, budget);
  for (;;) {
    if (await proxyHealthy()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(50, budget / 10))));
  }
}

// Detect drift: an agent is enabled in the manifest but its config no longer
// routes through the proxy (e.g. the user hand-edited it or another tool
// rewrote it). Reapplying the same settings repairs this.
function routingDrift(targets) {
  const drift = [];
  if (targets.includes("claude")) {
    let routed = false;
    try {
      const value = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf8"));
      routed = String(value?.env?.ANTHROPIC_BASE_URL || "").includes(`127.0.0.1:${proxyPort()}`);
    } catch { /* unreadable counts as not routed */ }
    if (!routed) drift.push("Claude Code is enabled but no longer routes through Headroom.");
  }
  if (targets.includes("codex")) {
    let routed = false;
    try {
      const value = fs.readFileSync(path.join(os.homedir(), ".codex", "config.toml"), "utf8");
      const root = value.split(/^\s*\[/m, 1)[0];
      routed = root.match(/^\s*model_provider\s*=\s*["']([^"']+)["']/m)?.[1] === "headroom";
    } catch { /* unreadable counts as not routed */ }
    if (!routed) drift.push("Codex is enabled but no longer routes through Headroom.");
  }
  return drift;
}

// Single source of truth for the integration state shown in the UI.
function deriveState(value) {
  if (!value.installed) return "not-installed";
  if (!value.compatible) return "upgrade-required";
  if (!value.targets?.length) return "ready";
  if (!value.healthy) return "proxy-stopped";
  if (value.warnings?.length) return "attention";
  return "active";
}

async function status() {
  const data = fixture();
  if (data?.status) {
    const value = { installerAvailable: true, minimumVersion: MIN_VERSION, ...data.status };
    value.state = value.state || deriveState(value);
    return value;
  }
  const found = await locate();
  const uv = await locateUv();
  if (!found.binary) {
    const value = { installed: false, compatible: false, version: null, healthy: false, targets: [], mode: "cache", warnings: [], installerAvailable: Boolean(uv.binary), minimumVersion: MIN_VERSION };
    return { ...value, state: deriveState(value) };
  }
  const manifest = readManifest();
  const healthy = await proxyHealthy();
  const warnings = [];
  if (!found.compatible) warnings.push(`Headroom ${MIN_VERSION} or newer is required.`);
  if (manifest && manifest.port !== proxyPort()) warnings.push("The managed profile uses an unexpected port.");
  if (found.compatible && manifest?.targets?.length) warnings.push(...routingDrift(manifest.targets));
  const value = {
    installed: true, compatible: found.compatible, version: found.version, healthy,
    targets: manifest?.targets || [], mode: manifest?.mode || "cache", warnings,
    installerAvailable: Boolean(uv.binary), minimumVersion: MIN_VERSION,
  };
  return { ...value, state: deriveState(value) };
}

// Append the last stderr line so failures are actionable in the UI. Paths
// are sanitized by the caller before display or logging.
function withDetail(message, error) {
  const detail = String(error?.stderr || "").trim().split("\n").filter(Boolean).at(-1) || "";
  return detail ? `${message} (${detail.slice(0, 160)})` : message;
}

async function installCliNow() {
  if (fixture()) throw new Error("Headroom installation is unavailable while fixture data is active.");
  const uv = await locateUv();
  if (!uv.binary) throw new Error("uv is required to install Headroom. Install uv with Homebrew, then try again.");
  try {
    await run(uv.binary, ["tool", "install", "--force", "--python", "3.13", `headroom-ai[proxy]==${MIN_VERSION}`], {
      timeout: 10 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(withDetail("Headroom installation failed; agent routing was not changed.", error));
  }
  const found = await locate();
  if (!found.binary || !found.compatible) throw new Error(`Headroom ${MIN_VERSION} was installed but could not be verified. Restart the app and try again.`);
  return status();
}

function clientName(value) {
  const name = String(value || "").toLowerCase();
  if (name.includes("claude")) return "claude";
  if (name.includes("codex")) return "codex";
  return "unknown";
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function summarizeRecords(records, days) {
  const cutoff = Date.now() - days * 86400_000;
  const valid = (Array.isArray(records) ? records : []).filter((record) => {
    const time = new Date(String(record.timestamp || "").replace(",", ".")).getTime();
    return Number.isFinite(time) ? time >= cutoff : true;
  });
  valid.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
  const agents = new Map(); const daily = new Map(); const transforms = new Map();
  let tokensBefore = 0; let tokensAfter = 0; let tokensSaved = 0; let latency = 0; let latencyCount = 0;
  for (const record of valid) {
    const before = finite(record.tokens_before); const after = finite(record.tokens_after);
    const saved = Math.min(finite(record.tokens_saved), before || finite(record.tokens_saved));
    tokensBefore += before; tokensAfter += after; tokensSaved += saved;
    const agent = clientName(record.client); const item = agents.get(agent) || { agent, requests: 0, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0 };
    item.requests += 1; item.tokensBefore += before; item.tokensAfter += after; item.tokensSaved += saved; agents.set(agent, item);
    const date = String(record.timestamp || "").slice(0, 10); const day = daily.get(date) || { date, tokensBefore: 0, tokensSaved: 0 };
    day.tokensBefore += before; day.tokensSaved += saved; daily.set(date, day);
    for (const transform of Array.isArray(record.transforms) ? record.transforms : []) transforms.set(transform, (transforms.get(transform) || 0) + 1);
    if (finite(record.optimization_ms) > 0) { latency += finite(record.optimization_ms); latencyCount += 1; }
  }
  const reduction = (saved, before) => before > 0 ? Math.round(saved / before * 1000) / 10 : 0;
  const agentRows = [...agents.values()].map((item) => ({ ...item, reductionPercent: reduction(item.tokensSaved, item.tokensBefore) }));
  const dailyRows = [...daily.values()].filter((item) => item.date).sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => ({ ...item, reductionPercent: reduction(item.tokensSaved, item.tokensBefore) }));
  return {
    coverage: { requestedDays: days, records: valid.length, oldest: valid[0]?.timestamp || null, newest: valid.at(-1)?.timestamp || null },
    inputCompression: { tokensBefore, tokensAfter, tokensSaved, reductionPercent: reduction(tokensSaved, tokensBefore), measurement: "measured" },
    agents: agentRows, daily: dailyRows,
    transforms: [...transforms.entries()].sort((a, b) => b[1] - a[1]).map(([name, uses]) => ({ name, uses })),
    reliability: { averageOptimizationMs: latencyCount ? Math.round(latency / latencyCount) : 0 },
  };
}

async function readSavings(days) {
  const data = fixture();
  if (data?.savings) return { status: data.status, ...data.savings };
  const current = await status();
  if (!current.installed || !current.compatible || !current.targets.length) return { status: current, ...summarizeRecords([], days) };
  const found = await locate();
  try {
    const output = await run(found.binary, ["perf", "--hours", String(days * 24), "--raw", "--format", "json"], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
    return { status: current, ...summarizeRecords(JSON.parse(output), days) };
  } catch (error) {
    return { status: current, ...summarizeRecords([], days), error: "Headroom metrics are temporarily unavailable." };
  }
}

function validateSettings(input) {
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !["targets", "mode"].includes(key))) throw new Error("settings contain unknown fields");
  if (!Array.isArray(input.targets) || input.targets.some((target) => !TARGETS.has(target))) throw new Error("targets must contain only claude and codex");
  if (!MODES.has(input.mode)) throw new Error("mode must be cache or token");
  return { targets: [...new Set(input.targets)].sort(), mode: input.mode };
}

function preflight(settings) {
  if (settings.targets.includes("claude")) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf8"));
      const url = value?.env?.ANTHROPIC_BASE_URL;
      if (url && !String(url).includes(`127.0.0.1:${proxyPort()}`)) throw new Error("Claude has a custom ANTHROPIC_BASE_URL. Remove it or disable Claude before applying Headroom.");
    } catch (error) { if (error.code !== "ENOENT" && error instanceof SyntaxError) throw new Error("Claude settings.json is not valid JSON."); if (String(error.message).startsWith("Claude has")) throw error; }
  }
  if (settings.targets.includes("codex")) {
    try {
      const value = fs.readFileSync(path.join(os.homedir(), ".codex", "config.toml"), "utf8");
      const root = value.split(/^\s*\[/m, 1)[0];
      const provider = root.match(/^\s*model_provider\s*=\s*["']([^"']+)["']/m)?.[1];
      const baseUrl = root.match(/^\s*openai_base_url\s*=\s*["']([^"']+)["']/m)?.[1];
      if ((provider && provider !== "headroom") || (baseUrl && !baseUrl.includes(`127.0.0.1:${proxyPort()}`))) {
        throw new Error("Codex has a custom model provider or OpenAI base URL. Restore its native provider or disable Codex before applying Headroom.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

// Best-effort restore to the safe state: profile removed, agents back on
// their native configuration. Failures surface later as drift warnings.
async function rollback(binary) {
  try { await run(binary, ["install", "remove", "--profile", PROFILE], { timeout: 60_000 }); }
  catch { /* status() will report remaining drift */ }
}

async function reconcileNow(input) {
  if (fixture()) throw new Error("This instance is showing demo fixture data; Headroom settings are read-only here.");
  const settings = validateSettings(input); preflight(settings);
  const found = await locate();
  if (!found.binary || !found.compatible) throw new Error(`Headroom ${MIN_VERSION} or newer is not installed. Use Install Headroom in Settings first.`);
  if (!settings.targets.length) {
    if (readManifest()) {
      try { await run(found.binary, ["install", "remove", "--profile", PROFILE], { timeout: 60_000 }); }
      catch (error) { throw new Error(withDetail("Headroom could not be disabled; agent routing may still point at the proxy.", error)); }
    }
    return status();
  }
  // Reapplying identical, healthy, correctly-routed settings is a no-op —
  // saving unrelated settings must not restart the proxy service.
  const manifest = readManifest();
  if (manifest && manifest.mode === settings.mode
    && manifest.targets.slice().sort().join(",") === settings.targets.join(",")
    && !routingDrift(settings.targets).length
    && await proxyHealthy()) return status();
  const args = ["install", "apply", "--profile", PROFILE, "--preset", "persistent-service", "--scope", "provider", "--providers", "manual"];
  for (const target of settings.targets) args.push("--target", target);
  args.push("--port", String(proxyPort()), "--mode", settings.mode, "--no-telemetry");
  try {
    await run(found.binary, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    await rollback(found.binary);
    throw new Error(withDetail("Headroom could not apply the agent setup; the change was rolled back and agents keep their native configuration.", error));
  }
  if (!(await waitForHealthy())) {
    await rollback(found.binary);
    throw new Error("Headroom applied the setup but its proxy never became healthy; the change was rolled back and agents keep their native configuration.");
  }
  return status();
}

let operationQueue = Promise.resolve();
function queueOperation(action) {
  const result = operationQueue.then(action);
  operationQueue = result.catch(() => {});
  return result;
}

function reconcile(input) {
  return queueOperation(() => reconcileNow(input));
}

function installCli() { return queueOperation(installCliNow); }

module.exports = { MIN_VERSION, PORT, PROFILE, workspaceDir, versionAtLeast, locate, locateUv, status, installCli, readSavings, summarizeRecords, validateSettings, reconcile, routingDrift, deriveState };
