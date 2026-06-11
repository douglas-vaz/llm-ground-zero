const test = require("node:test");
const assert = require("node:assert");
const { startServer } = require("../server");

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
