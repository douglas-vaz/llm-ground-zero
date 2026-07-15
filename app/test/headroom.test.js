const test = require("node:test");
const assert = require("node:assert");
const headroom = require("../integrations/headroom");

test("validates compatible Headroom versions and settings", () => {
  assert.strictEqual(headroom.versionAtLeast("0.31.0"), true);
  assert.strictEqual(headroom.versionAtLeast("0.30.9"), false);
  assert.deepStrictEqual(headroom.validateSettings({ targets: ["codex", "claude", "codex"], mode: "cache" }), {
    targets: ["claude", "codex"], mode: "cache",
  });
  assert.throws(() => headroom.validateSettings({ targets: ["gemini"], mode: "cache" }));
  assert.throws(() => headroom.validateSettings({ targets: [], mode: "turbo" }));
});

test("aggregates measured savings by client with a weighted denominator", () => {
  const now = new Date().toISOString();
  const value = headroom.summarizeRecords([
    { timestamp: now, client: "claude-code", tokens_before: 1000, tokens_after: 700, tokens_saved: 300, optimization_ms: 80, transforms: ["router"] },
    { timestamp: now, client: "codex", tokens_before: 100, tokens_after: 90, tokens_saved: 10, optimization_ms: 20, transforms: ["router", "cache"] },
  ], 7);
  assert.strictEqual(value.inputCompression.tokensSaved, 310);
  assert.strictEqual(value.inputCompression.reductionPercent, 28.2);
  assert.strictEqual(value.agents.find((row) => row.agent === "claude").reductionPercent, 30);
  assert.strictEqual(value.reliability.averageOptimizationMs, 50);
  assert.deepStrictEqual(value.transforms[0], { name: "router", uses: 2 });
});
