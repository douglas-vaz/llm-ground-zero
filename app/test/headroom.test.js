const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

test("installs the pinned Headroom CLI with uv without enabling agents", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-headroom-install-"));
  const versionFile = path.join(dir, "version");
  const invocationFile = path.join(dir, "uv-args");
  const fakeHeadroom = path.join(dir, "headroom");
  const fakeUv = path.join(dir, "uv");
  fs.writeFileSync(versionFile, "0.28.0");
  fs.writeFileSync(fakeHeadroom, `#!/bin/sh\nprintf 'headroom %s\\n' "$(cat "$FAKE_HEADROOM_VERSION")"\n`);
  fs.writeFileSync(fakeUv, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'uv 0.11.3'; exit 0; fi\nprintf '%s\\n' "$*" > "$FAKE_UV_INVOCATION"\nprintf '0.31.0' > "$FAKE_HEADROOM_VERSION"\n`);
  fs.chmodSync(fakeHeadroom, 0o755); fs.chmodSync(fakeUv, 0o755);
  process.env.LLM_GROUND_ZERO_HEADROOM_BIN = fakeHeadroom;
  process.env.LLM_GROUND_ZERO_UV_BIN = fakeUv;
  process.env.FAKE_HEADROOM_VERSION = versionFile;
  process.env.FAKE_UV_INVOCATION = invocationFile;
  try {
    const result = await headroom.installCli();
    assert.strictEqual(result.version, "0.31.0");
    assert.strictEqual(result.compatible, true);
    assert.deepStrictEqual(result.targets, []);
    assert.strictEqual(fs.readFileSync(invocationFile, "utf8").trim(), "tool install --force --python 3.13 headroom-ai[proxy]==0.31.0");
  } finally {
    for (const key of ["LLM_GROUND_ZERO_HEADROOM_BIN", "LLM_GROUND_ZERO_UV_BIN", "FAKE_HEADROOM_VERSION", "FAKE_UV_INVOCATION"]) delete process.env[key];
  }
});
