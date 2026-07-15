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
const advisor = require("./advisor");
const advisorParsers = require("./advisor/parsers");
const advisorUsage = require("./advisor/usage");
const advisorStore = require("./advisor/store");
const headroom = require("./integrations/headroom");

const HOME = os.homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const CODEX_SESSIONS = path.join(HOME, ".codex", "sessions");
const ENGRAM_DB = process.env.ENGRAM_DATA_DIR
  ? path.join(process.env.ENGRAM_DATA_DIR, "engram.db")
  : path.join(HOME, "llm-ground-zero", "data", "engram.db");
const STATIC_DIR = path.join(__dirname, "static");
const VERSION = require("./package.json").version;
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
// ccusage ships a node CLI; spawn it with our own runtime. In a packaged
// Electron app the binary doubles as node via ELECTRON_RUN_AS_NODE, and the
// asar-unpacked copy is the one a plain node process can actually read.
const CCUSAGE_CLI = path
  .join(__dirname, "node_modules", "ccusage", "dist", "cli.js")
  .replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);

const cache = new Map();
const CACHE_TTL = 60_000;
const ADVISOR_RANGES = new Set([7, 30, 90]);

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;
  // Cache the pending promise too, so overlapping refreshes do not launch
  // duplicate ccusage processes or scan the same session trees twice.
  const pending = Promise.resolve().then(fn);
  cache.set(key, { t: Date.now(), v: pending });
  try {
    const value = await pending;
    cache.set(key, { t: Date.now(), v: value });
    return value;
  } catch (error) {
    if (cache.get(key)?.v === pending) cache.delete(key);
    throw error;
  }
}

function ccusageJson(component, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CCUSAGE_CLI, ...args, "--json"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        logError(component, err, { version: VERSION });
        resolve({ error: "ccusage failed; check the local error log for details" });
      } else {
        try { resolve(JSON.parse(stdout)); }
        catch (e) {
          logError(component, e, { version: VERSION });
          resolve({ error: "ccusage output was not JSON" });
        }
      }
    });
  });
}

function rangeDays(value) {
  const parsed = Number(String(value || "7d").replace(/d$/, ""));
  return ADVISOR_RANGES.has(parsed) ? parsed : null;
}

async function buildAdvisor(days) {
  const sinceMs = Date.now() - days * 86400_000;
  const loaded = advisorParsers.loadSessions({
    claudeRoot: CLAUDE_PROJECTS, codexRoot: CODEX_SESSIONS, sinceMs,
  });
  const since = new Date(sinceMs).toISOString().slice(0, 10);
  const usagePayload = await ccusageJson(`advisor-usage-${days}`, ["session", "--since", since]);
  const joined = advisorUsage.joinUsage(loaded.sessions, usagePayload.error ? {} : usagePayload);
  const result = advisor.analyze({
    sessions: joined.sessions,
    memories: lib.advisorMemories(ENGRAM_DB, 100),
    state: advisorStore.readState(), rangeDays: days,
    coverage: { ...joined.coverage, scannedSessions: loaded.scanned, warnings: loaded.warnings },
  });
  if (usagePayload.error) result.coverage.warnings.push({ type: "usage_unavailable" });
  return result;
}

async function advisorResponse(days, fresh = false) {
  const key = `advisor-${days}`;
  if (fresh) cache.delete(key);
  return cached(key, () => buildAdvisor(days));
}

function publicAdvisor(result) {
  const { evidence, ...body } = result;
  return body;
}

function json(res, status, value) {
  writeHead(res, status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

function validMutation(req) {
  const origin = req.headers.origin;
  return req.headers["x-llm-ground-zero-action"] === "1"
    && typeof origin === "string"
    && origin === `http://${req.headers.host}`;
}

function readJsonBody(req, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      reject(Object.assign(new Error("content type must be application/json"), { status: 415 }));
      return;
    }
    let body = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        tooLarge = true;
        reject(Object.assign(new Error("request body too large"), { status: 413 }));
      }
    });
    req.on("end", () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(Object.assign(new Error("invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function clearAdvisorCache() {
  for (const key of cache.keys()) if (key.startsWith("advisor-")) cache.delete(key);
}

function headroomDays(value) {
  const parsed = Number(String(value || "30d").replace(/d$/, ""));
  return ADVISOR_RANGES.has(parsed) ? parsed : null;
}

async function handleHeadroom(req, res, requestUrl) {
  if (requestUrl.pathname === "/api/headroom/status" && req.method === "GET") {
    if (requestUrl.searchParams.get("fresh") === "1") cache.delete("headroom-status");
    json(res, 200, await cached("headroom-status", () => headroom.status()));
    return true;
  }
  if (requestUrl.pathname === "/api/headroom" && req.method === "GET") {
    const days = headroomDays(requestUrl.searchParams.get("range"));
    if (!days) { json(res, 400, { error: "range must be 7d, 30d, or 90d" }); return true; }
    const key = `headroom-${days}`;
    if (requestUrl.searchParams.get("fresh") === "1") cache.delete(key);
    json(res, 200, await cached(key, () => headroom.readSavings(days)));
    return true;
  }
  if (requestUrl.pathname === "/api/headroom/install" && req.method === "POST") {
    if (!validMutation(req)) { json(res, 403, { error: "same-origin action header required" }); return true; }
    try {
      const body = await readJsonBody(req);
      if (Object.keys(body).length) throw new Error("install request must be empty");
      const result = await headroom.installCli();
      for (const key of cache.keys()) if (key.startsWith("headroom")) cache.delete(key);
      json(res, 200, result);
    } catch (error) { json(res, error.status || 400, { error: sanitize(error.message || String(error)).slice(0, 300) }); }
    return true;
  }
  if (requestUrl.pathname === "/api/headroom/settings" && req.method === "PUT") {
    if (!validMutation(req)) { json(res, 403, { error: "same-origin action header required" }); return true; }
    try {
      const result = await headroom.reconcile(await readJsonBody(req));
      for (const key of cache.keys()) if (key.startsWith("headroom")) cache.delete(key);
      json(res, 200, result);
    } catch (error) { json(res, error.status || 400, { error: sanitize(error.message || String(error)).slice(0, 300) }); }
    return true;
  }
  if (requestUrl.pathname.startsWith("/api/headroom")) {
    json(res, 405, { error: "method not allowed" });
    return true;
  }
  return false;
}

async function handleAdvisor(req, res, requestUrl) {
  const days = rangeDays(requestUrl.searchParams.get("range"));
  if (!days) { json(res, 400, { error: "range must be 7d, 30d, or 90d" }); return true; }

  if (requestUrl.pathname === "/api/advisor" && req.method === "GET") {
    const result = await advisorResponse(days, requestUrl.searchParams.get("fresh") === "1");
    json(res, 200, publicAdvisor(result));
    return true;
  }
  if (requestUrl.pathname === "/api/advisor/evidence" && req.method === "GET") {
    const id = requestUrl.searchParams.get("id") || "";
    const result = await advisorResponse(days, false);
    if (!result.evidence[id]) json(res, 404, { error: "evidence not found" });
    else json(res, 200, { id, evidence: result.evidence[id] });
    return true;
  }
  if (requestUrl.pathname === "/api/advisor/settings" && req.method === "GET") {
    json(res, 200, { subscriptions: advisorStore.readState().subscriptions });
    return true;
  }
  const outcomeMatch = requestUrl.pathname.match(/^\/api\/advisor\/outcomes\/([a-z0-9-]{1,100})$/i);
  const mutation = requestUrl.pathname === "/api/advisor/settings" || outcomeMatch;
  if (mutation && ["PUT", "DELETE"].includes(req.method)) {
    if (!validMutation(req)) { json(res, 403, { error: "same-origin action header required" }); return true; }
    try {
      const state = advisorStore.readState();
      if (requestUrl.pathname === "/api/advisor/settings" && req.method === "PUT") {
        const body = await readJsonBody(req);
        if (Object.keys(body).some((key) => key !== "subscriptions")) throw new Error("settings contain unknown fields");
        state.subscriptions = advisorStore.validateSubscriptions(body.subscriptions);
      } else if (outcomeMatch && req.method === "PUT") {
        state.outcomes[outcomeMatch[1]] = advisorStore.validateOutcome(await readJsonBody(req));
      } else if (outcomeMatch && req.method === "DELETE") {
        delete state.outcomes[outcomeMatch[1]];
      } else { json(res, 405, { error: "method not allowed" }); return true; }
      advisorStore.writeState(state);
      clearAdvisorCache();
      json(res, 200, outcomeMatch ? { outcome: state.outcomes[outcomeMatch[1]] || null } : { subscriptions: state.subscriptions });
    } catch (error) {
      json(res, error.status || 400, { error: String(error.message || error).slice(0, 200) });
    }
    return true;
  }
  if (requestUrl.pathname.startsWith("/api/advisor")) {
    json(res, 405, { error: "method not allowed" });
    return true;
  }
  return false;
}

function guard(component, fn) {
  return async (fresh) => {
    try {
      if (fresh) cache.delete(component);
      return await cached(component, fn);
    } catch (e) {
      logError(component, e, { version: VERSION });
      return { error: sanitize(e.message || String(e)).slice(0, 300) };
    }
  };
}

const ROUTES = {
  "/api/usage": guard("usage", () => ccusageJson("usage", ["daily"])),
  "/api/blocks": guard("blocks", () => ccusageJson("blocks", ["blocks"])),
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

const STATIC_FILES = {
  "/": [path.join(STATIC_DIR, "index.html"), "text/html; charset=utf-8"],
  "/index.html": [path.join(STATIC_DIR, "index.html"), "text/html; charset=utf-8"],
  "/app.js": [path.join(STATIC_DIR, "app.js"), "text/javascript; charset=utf-8"],
  "/styles.css": [path.join(STATIC_DIR, "styles.css"), "text/css; charset=utf-8"],
  "/vendor/chart.umd.js": [path.join(__dirname, "node_modules", "chart.js", "dist", "chart.umd.js"), "text/javascript; charset=utf-8"],
};

function writeHead(res, status, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
}

function startServer(port = 7788) {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname.startsWith("/api/headroom")) {
      try { if (await handleHeadroom(req, res, requestUrl)) return; }
      catch (e) {
        logError("headroom", e, { version: VERSION });
        json(res, 500, { error: "Headroom integration failed; check the local error log" });
        return;
      }
    }
    if (requestUrl.pathname.startsWith("/api/advisor")) {
      try { if (await handleAdvisor(req, res, requestUrl)) return; }
      catch (e) {
        logError("advisor", e, { version: VERSION });
        json(res, 500, { error: "advisor failed; check the local error log" });
        return;
      }
    }
    if (req.method !== "GET") {
      writeHead(res, 405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" });
      res.end("method not allowed");
      return;
    }
    const route = ROUTES[requestUrl.pathname];
    if (route) {
      const fresh = requestUrl.searchParams.get("fresh") === "1";
      const body = JSON.stringify(await route(fresh));
      writeHead(res, 200, { "Content-Type": "application/json" });
      res.end(body);
    } else if (requestUrl.pathname === "/api/health") {
      writeHead(res, 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ app: "llm-ground-zero", version: VERSION }));
    } else if (STATIC_FILES[requestUrl.pathname]) {
      try {
        const [file, contentType] = STATIC_FILES[requestUrl.pathname];
        const content = await fs.promises.readFile(file);
        writeHead(res, 200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
        res.end(content);
      } catch (e) {
        logError("static", e, { version: VERSION });
        writeHead(res, 500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("could not load dashboard");
      }
    } else {
      writeHead(res, 404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { startServer, _cache: cache };

if (require.main === module) {
  const port = Number(process.argv[2] || process.env.LLM_GROUND_ZERO_PORT || 7788);
  startServer(port).then(() =>
    console.log(`llm-ground-zero dashboard → http://localhost:${port}`));
}
