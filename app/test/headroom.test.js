const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const headroom = require("../integrations/headroom");

// Fake headroom CLI: answers --version, records every other invocation, and
// writes/removes the profile manifest the way the real installer does.
function fakeHeadroomBin(dir) {
  const bin = path.join(dir, "headroom");
  fs.writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "headroom 0.31.0"; exit 0; fi
printf '%s\\n' "$*" >> "$FAKE_HEADROOM_LOG"
case "$*" in
  *"install apply"*)
    if [ -n "$FAKE_APPLY_FAIL" ]; then echo "uvx service refused to start" >&2; exit 1; fi
    mkdir -p "$HEADROOM_WORKSPACE_DIR/deploy/llm-ground-zero"
    printf '%s' "$FAKE_MANIFEST" > "$HEADROOM_WORKSPACE_DIR/deploy/llm-ground-zero/manifest.json"
    ;;
  *"install remove"*)
    rm -f "$HEADROOM_WORKSPACE_DIR/deploy/llm-ground-zero/manifest.json"
    ;;
esac
exit 0
`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

function routedHome(dir, port) {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` } }));
  fs.mkdirSync(path.join(dir, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".codex", "config.toml"), 'model_provider = "headroom"\n');
}

function healthServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "healthy" }));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closedPort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function withHeadroomEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  try { return await fn(); } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function headroomEnv(dir, port, extra = {}) {
  return {
    HOME: dir,
    LLM_GROUND_ZERO_HEADROOM_BIN: fakeHeadroomBin(dir),
    LLM_GROUND_ZERO_HEADROOM_WORKSPACE: path.join(dir, "workspace"),
    LLM_GROUND_ZERO_HEADROOM_PORT: port,
    LLM_GROUND_ZERO_HEADROOM_HEALTH_WAIT_MS: 50,
    FAKE_HEADROOM_LOG: path.join(dir, "invocations.log"),
    FAKE_MANIFEST: JSON.stringify({ targets: ["claude"], proxy_mode: "cache", port }),
    FAKE_APPLY_FAIL: undefined,
    ...extra,
  };
}

function invocations(dir) {
  try { return fs.readFileSync(path.join(dir, "invocations.log"), "utf8").trim().split("\n"); }
  catch { return []; }
}

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

test("derives a single UI state from the status fields", () => {
  assert.strictEqual(headroom.deriveState({ installed: false }), "not-installed");
  assert.strictEqual(headroom.deriveState({ installed: true, compatible: false }), "upgrade-required");
  assert.strictEqual(headroom.deriveState({ installed: true, compatible: true, targets: [] }), "ready");
  assert.strictEqual(headroom.deriveState({ installed: true, compatible: true, targets: ["claude"], healthy: false }), "proxy-stopped");
  assert.strictEqual(headroom.deriveState({ installed: true, compatible: true, targets: ["claude"], healthy: true, warnings: ["drift"] }), "attention");
  assert.strictEqual(headroom.deriveState({ installed: true, compatible: true, targets: ["claude"], healthy: true, warnings: [] }), "active");
});

test("reconcile applies settings and confirms the proxy is healthy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-headroom-apply-"));
  const proxy = await healthServer();
  const port = proxy.address().port;
  routedHome(dir, port);
  try {
    await withHeadroomEnv(headroomEnv(dir, port), async () => {
      const result = await headroom.reconcile({ targets: ["claude"], mode: "cache" });
      assert.deepStrictEqual(result.targets, ["claude"]);
      assert.strictEqual(result.healthy, true);
      assert.strictEqual(result.state, "active");
      assert.deepStrictEqual(result.warnings, []);
      const calls = invocations(dir);
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].includes("install apply"));
      assert.ok(calls[0].includes(`--port ${port}`));
    });
  } finally { proxy.close(); }
});

test("reconcile with unchanged healthy settings does not restart the proxy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-headroom-noop-"));
  const proxy = await healthServer();
  const port = proxy.address().port;
  routedHome(dir, port);
  const env = headroomEnv(dir, port);
  const manifestDir = path.join(env.LLM_GROUND_ZERO_HEADROOM_WORKSPACE, "deploy", "llm-ground-zero");
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, "manifest.json"), env.FAKE_MANIFEST);
  try {
    await withHeadroomEnv(env, async () => {
      const result = await headroom.reconcile({ targets: ["claude"], mode: "cache" });
      assert.strictEqual(result.state, "active");
      assert.deepStrictEqual(invocations(dir), [], "identical settings must not reapply");
    });
  } finally { proxy.close(); }
});

test("reconcile rolls back when the apply command fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-headroom-fail-"));
  const port = await closedPort();
  routedHome(dir, port);
  await withHeadroomEnv(headroomEnv(dir, port, { FAKE_APPLY_FAIL: "1" }), async () => {
    await assert.rejects(() => headroom.reconcile({ targets: ["claude"], mode: "cache" }), (error) => {
      assert.match(error.message, /rolled back/);
      assert.match(error.message, /uvx service refused to start/);
      return true;
    });
    const calls = invocations(dir);
    assert.ok(calls.some((line) => line.includes("install remove")), "rollback must remove the profile");
  });
});

test("reconcile rolls back when the proxy never becomes healthy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-headroom-sick-"));
  const port = await closedPort();
  routedHome(dir, port);
  await withHeadroomEnv(headroomEnv(dir, port), async () => {
    await assert.rejects(() => headroom.reconcile({ targets: ["claude"], mode: "cache" }),
      /never became healthy.*rolled back/);
    const calls = invocations(dir);
    assert.ok(calls.some((line) => line.includes("install apply")));
    assert.ok(calls.some((line) => line.includes("install remove")), "rollback must remove the profile");
    assert.ok(!fs.existsSync(path.join(process.env.LLM_GROUND_ZERO_HEADROOM_WORKSPACE || "", "deploy", "llm-ground-zero", "manifest.json")));
  });
});

test("status flags routing drift for enabled agents", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-headroom-drift-"));
  const proxy = await healthServer();
  const port = proxy.address().port;
  // HOME exists but neither agent config routes through the proxy.
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{}");
  const env = headroomEnv(dir, port, {
    FAKE_MANIFEST: JSON.stringify({ targets: ["claude", "codex"], proxy_mode: "cache", port }),
  });
  const manifestDir = path.join(env.LLM_GROUND_ZERO_HEADROOM_WORKSPACE, "deploy", "llm-ground-zero");
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, "manifest.json"), env.FAKE_MANIFEST);
  try {
    await withHeadroomEnv(env, async () => {
      const result = await headroom.status();
      assert.strictEqual(result.state, "attention");
      assert.strictEqual(result.warnings.length, 2);
      assert.match(result.warnings[0], /Claude Code.*no longer routes/);
      assert.match(result.warnings[1], /Codex.*no longer routes/);
    });
  } finally { proxy.close(); }
});

test("fixture status gains a derived state", async () => {
  await withHeadroomEnv({ LLM_GROUND_ZERO_HEADROOM_FIXTURE: path.join(__dirname, "fixtures", "headroom", "dashboard.json") }, async () => {
    const result = await headroom.status();
    assert.strictEqual(result.state, "active");
  });
});

test("reconcile refuses clearly while fixture data is active", async () => {
  await withHeadroomEnv({ LLM_GROUND_ZERO_HEADROOM_FIXTURE: path.join(__dirname, "fixtures", "headroom", "dashboard.json") }, async () => {
    await assert.rejects(() => headroom.reconcile({ targets: ["claude"], mode: "cache" }),
      /demo fixture data.*read-only/);
  });
});
