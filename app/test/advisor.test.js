const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const parsers = require("../advisor/parsers");
const usage = require("../advisor/usage");
const friction = require("../advisor/friction");
const outcomes = require("../advisor/outcomes");
const { analyze } = require("../advisor");
const store = require("../advisor/store");

const fixtureDir = path.join(__dirname, "fixtures", "advisor");
const rows = (name) => fs.readFileSync(path.join(fixtureDir, name), "utf8").trim().split("\n").map(JSON.parse);

test("normalizes Claude and Codex sessions into shared events", () => {
  const claude = parsers.parseClaudeRows(rows("claude-session.jsonl"), "/tmp/claude-fixture-1.jsonl");
  const codex = parsers.parseCodexRows(rows("codex-session.jsonl"), "/tmp/rollout-codex-fixture-1.jsonl");
  assert.strictEqual(claude.agent, "claude");
  assert.strictEqual(claude.project, "sample-product");
  assert.ok(claude.events.some((event) => event.category === "commit" && event.status === "success"));
  assert.strictEqual(codex.agent, "codex");
  assert.strictEqual(codex.project, "sample-research");
  assert.ok(codex.events.some((event) => event.category === "memory_recall"));
  assert.ok(codex.events.some((event) => event.category === "test" && event.status === "failure"));
});

test("joins priced usage and treats zero-cost sessions as unpriced", () => {
  const sessions = [
    parsers.parseClaudeRows(rows("claude-session.jsonl")),
    parsers.parseCodexRows(rows("codex-session.jsonl"), "rollout-codex-fixture-1.jsonl"),
  ];
  const payload = JSON.parse(fs.readFileSync(path.join(fixtureDir, "ccusage-session.json")));
  const joined = usage.joinUsage(sessions, payload);
  assert.strictEqual(joined.sessions[0].usage.costUSD, 4.25);
  assert.strictEqual(joined.sessions[0].usage.priced, true);
  assert.strictEqual(joined.sessions[1].usage.matched, true);
  assert.strictEqual(joined.sessions[1].usage.priced, false);
  assert.strictEqual(joined.coverage.matchedSessions, 2);
  assert.strictEqual(joined.coverage.pricedSessions, 1);
});

test("repeated briefings require three same-project sessions", () => {
  const base = parsers.parseClaudeRows(rows("claude-session.jsonl"));
  const sessions = [0, 1, 2].map((index) => ({
    ...base, id: `s-${index}`, sourceId: `source-${index}`,
    events: base.events.map((event) => ({ ...event, id: `${event.id}-${index}` })),
    usage: { priced: false, costUSD: 0 },
  }));
  const result = friction.analyzeFriction(sessions);
  assert.ok(result.signals.some((signal) => signal.type === "repeated_briefing"));
  const crossProject = sessions.map((session, index) => ({ ...session, project: `p-${index}` }));
  assert.ok(!friction.analyzeFriction(crossProject).signals.some((signal) => signal.type === "repeated_briefing"));
});

test("manual outcomes override cautious inference", () => {
  const session = parsers.parseClaudeRows(rows("claude-session.jsonl"));
  session.usage = { priced: true, costUSD: 4.25 };
  assert.strictEqual(outcomes.inferOutcome(session).status, "shipped");
  const ledger = outcomes.outcomeLedger([session], {
    [session.id]: { status: "paused", type: "prototype", note: "Review later" },
  });
  assert.strictEqual(ledger[0].outcome.status, "paused");
  assert.strictEqual(ledger[0].outcome.confidence, 1);
});

test("advisor summary returns bounded recommendations and private public sessions", () => {
  const base = parsers.parseClaudeRows(rows("claude-session.jsonl"));
  const sessions = [0, 1, 2].map((index) => ({
    ...base, id: `session-${index}`, sourceId: `source-${index}`,
    events: base.events.map((event) => ({ ...event, id: `${event.id}-${index}` })),
    usage: { matched: true, priced: true, costUSD: 2, totalTokens: 1000 },
  }));
  const result = analyze({ sessions, rangeDays: 7, coverage: { pricingPercent: 100 } });
  assert.ok(result.overview.recommendations.length <= 3);
  assert.strictEqual(result.outcomes.metrics.outcomes, 3);
  assert.ok(!Object.hasOwn(result.outcomes.sessions[0], "sourceFile"));
  assert.ok(Object.keys(result.evidence).length >= 1);
});

test("advisor state validates and writes atomically with private permissions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-advisor-"));
  const file = path.join(dir, "advisor.json");
  const subscriptions = store.validateSubscriptions([{ provider: "Example", plan: "Pro", monthlyPrice: 20, currency: "usd" }]);
  const state = { schemaVersion: 1, subscriptions, outcomes: {} };
  store.writeState(state, file);
  assert.deepStrictEqual(store.readState(file), state);
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => store.validateSubscriptions([{ provider: "x", monthlyPrice: 1, path: "/tmp" }]));
  assert.throws(() => store.validateOutcome({ status: "invented", type: "code" }));
});
