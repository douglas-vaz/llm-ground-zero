const test = require("node:test");
const assert = require("node:assert");
const { startServer, _cache } = require("../server");

test("server serves index.html and degrading API endpoints", async () => {
  const server = await startServer(0); // ephemeral port
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const html = await fetch(base + "/").then((r) => r.text());
    assert.ok(html.includes("llm-"));

    for (const ep of ["tools", "conversations", "memories"]) {
      const res = await fetch(`${base}/api/${ep}`);
      assert.strictEqual(res.headers.get("content-type"), "application/json");
      const body = await res.json();
      // real or empty data, or a per-panel error — never a crash
      assert.ok(typeof body === "object" && body !== null);
    }

    const missing = await fetch(base + "/nope");
    assert.strictEqual(missing.status, 404);
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
