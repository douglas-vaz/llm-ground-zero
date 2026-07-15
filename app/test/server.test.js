const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startServer, _cache } = require("../server");

test("server serves index.html and degrading API endpoints", async () => {
  const server = await startServer(0); // ephemeral port
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const html = await fetch(base + "/").then((r) => r.text());
    assert.ok(html.includes("llm-"));

    const indexResponse = await fetch(base + "/");
    assert.ok(indexResponse.headers.get("content-security-policy").includes("default-src 'self'"));
    assert.ok(!await indexResponse.text().then((body) => body.includes("cdn.jsdelivr.net")));

    const chart = await fetch(base + "/vendor/chart.umd.js");
    assert.strictEqual(chart.status, 200);
    assert.ok(chart.headers.get("content-type").startsWith("text/javascript"));

    const health = await fetch(base + "/api/health").then((r) => r.json());
    assert.strictEqual(health.app, "llm-ground-zero");

    for (const ep of ["tools", "conversations", "memories"]) {
      const res = await fetch(`${base}/api/${ep}`);
      assert.strictEqual(res.headers.get("content-type"), "application/json");
      const body = await res.json();
      // real or empty data, or a per-panel error — never a crash
      assert.ok(typeof body === "object" && body !== null);
    }

    const missing = await fetch(base + "/nope");
    assert.strictEqual(missing.status, 404);

    const post = await fetch(base + "/api/memories", { method: "POST" });
    assert.strictEqual(post.status, 405);
  } finally {
    server.close();
  }
});

test("?fresh=1 busts the response cache", async () => {
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    _cache.set("memories", { t: Date.now(), v: [{ sentinel: true }] });
    const cachedBody = await fetch(`${base}/api/memories`).then((r) => r.json());
    assert.ok(cachedBody[0] && cachedBody[0].sentinel, "cache should serve sentinel");
    const fresh = await fetch(`${base}/api/memories?fresh=1`).then((r) => r.json());
    assert.ok(!fresh[0] || !fresh[0].sentinel, "fresh=1 should bypass the cache");
  } finally {
    _cache.clear();
    server.close();
  }
});

test("advisor settings and outcomes require same-origin explicit mutations", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgz-advisor-http-"));
  process.env.LLM_GROUND_ZERO_ADVISOR_PATH = path.join(dir, "advisor.json");
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Origin: base,
    "Content-Type": "application/json",
    "X-LLM-Ground-Zero-Action": "1",
  };
  try {
    const badRange = await fetch(`${base}/api/advisor?range=14d`);
    assert.strictEqual(badRange.status, 400);

    const blocked = await fetch(`${base}/api/advisor/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.strictEqual(blocked.status, 403);

    const settings = await fetch(`${base}/api/advisor/settings`, {
      method: "PUT", headers,
      body: JSON.stringify({ subscriptions: [{ provider: "Example", plan: "Pro", monthlyPrice: 20, currency: "USD" }] }),
    });
    assert.strictEqual(settings.status, 200);
    assert.strictEqual((await settings.json()).subscriptions[0].monthlyPrice, 20);

    const oversized = await fetch(`${base}/api/advisor/settings`, {
      method: "PUT", headers, body: JSON.stringify({ subscriptions: [], padding: "x".repeat(33 * 1024) }),
    });
    assert.strictEqual(oversized.status, 413);

    const outcome = await fetch(`${base}/api/advisor/outcomes/claude-abc123`, {
      method: "PUT", headers,
      body: JSON.stringify({ status: "paused", type: "prototype", note: "resume later" }),
    });
    assert.strictEqual(outcome.status, 200);
    const stored = JSON.parse(fs.readFileSync(process.env.LLM_GROUND_ZERO_ADVISOR_PATH));
    assert.strictEqual(stored.outcomes["claude-abc123"].status, "paused");
    assert.strictEqual(fs.statSync(process.env.LLM_GROUND_ZERO_ADVISOR_PATH).mode & 0o777, 0o600);

    const deleted = await fetch(`${base}/api/advisor/outcomes/claude-abc123`, { method: "DELETE", headers });
    assert.strictEqual(deleted.status, 200);
  } finally {
    server.close();
    delete process.env.LLM_GROUND_ZERO_ADVISOR_PATH;
  }
});

test("Headroom endpoints expose measured savings and protect mutations", async () => {
  process.env.LLM_GROUND_ZERO_HEADROOM_FIXTURE = path.join(__dirname, "fixtures", "headroom", "dashboard.json");
  _cache.clear();
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/headroom?range=30d`);
    assert.strictEqual(response.status, 200);
    const savings = await response.json();
    assert.strictEqual(savings.status.targets.join(","), "claude,codex");
    assert.strictEqual(savings.inputCompression.tokensSaved, 341200);
    assert.strictEqual(savings.inputCompression.measurement, "measured");

    const status = await fetch(`${base}/api/headroom/status`).then((value) => value.json());
    assert.strictEqual(status.healthy, true);

    assert.strictEqual((await fetch(`${base}/api/headroom?range=14d`)).status, 400);
    assert.strictEqual((await fetch(`${base}/api/headroom/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}",
    })).status, 403);
    assert.strictEqual((await fetch(`${base}/api/headroom/install`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    })).status, 403);
    const mutationHeaders = { Origin: base, "Content-Type": "application/json", "X-LLM-Ground-Zero-Action": "1" };
    assert.strictEqual((await fetch(`${base}/api/headroom/install`, {
      method: "POST", headers: mutationHeaders, body: JSON.stringify({ binary: "/tmp/headroom" }),
    })).status, 400);
  } finally {
    _cache.clear();
    server.close();
    delete process.env.LLM_GROUND_ZERO_HEADROOM_FIXTURE;
  }
});
