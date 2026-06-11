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
