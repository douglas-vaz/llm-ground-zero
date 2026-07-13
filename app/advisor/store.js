"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { VALID_STATUS, VALID_TYPE } = require("./outcomes");

function statePath() {
  return process.env.LLM_GROUND_ZERO_ADVISOR_PATH
    || path.join(os.homedir(), "Library", "Application Support", "LLM Ground Zero", "advisor.json");
}

function defaults() { return { schemaVersion: 1, subscriptions: [], outcomes: {} }; }

function readState(file = statePath()) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.subscriptions)
        || !value.outcomes || typeof value.outcomes !== "object") throw new Error("invalid advisor state");
    return { ...defaults(), ...value };
  } catch {
    if (fs.existsSync(file)) {
      try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* read-only recovery */ }
    }
    return defaults();
  }
}

function writeState(value, file = statePath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
  return value;
}

function validateSubscriptions(input) {
  if (!Array.isArray(input) || input.length > 20) throw new Error("subscriptions must be an array of at most 20 entries");
  return input.map((entry) => {
    const allowed = new Set(["provider", "plan", "monthlyPrice", "currency"]);
    if (!entry || typeof entry !== "object" || Object.keys(entry).some((key) => !allowed.has(key))) throw new Error("subscription contains unknown fields");
    const monthlyPrice = Number(entry.monthlyPrice);
    if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0 || monthlyPrice > 100000) throw new Error("invalid monthly price");
    return {
      provider: String(entry.provider || "").slice(0, 60), plan: String(entry.plan || "").slice(0, 60),
      monthlyPrice, currency: String(entry.currency || "USD").slice(0, 3).toUpperCase(),
    };
  });
}

function validateOutcome(input) {
  const allowed = new Set(["status", "type", "note"]);
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !allowed.has(key))) throw new Error("outcome contains unknown fields");
  if (!VALID_STATUS.has(input.status) || !VALID_TYPE.has(input.type)) throw new Error("invalid outcome status or type");
  return { status: input.status, type: input.type, note: String(input.note || "").slice(0, 500), updatedAt: new Date().toISOString() };
}

module.exports = { statePath, defaults, readState, writeState, validateSubscriptions, validateOutcome };
