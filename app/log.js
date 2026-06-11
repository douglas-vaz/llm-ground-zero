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
