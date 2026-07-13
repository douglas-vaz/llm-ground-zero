const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const staticDir = path.join(__dirname, "..", "static");

test("frontend uses local assets and safe DOM rendering", () => {
  const html = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(staticDir, "app.js"), "utf8");
  assert.ok(html.includes('src="/vendor/chart.umd.js"'));
  assert.ok(!html.includes("https://"));
  assert.ok(!js.includes("innerHTML"));
  assert.ok(!js.includes("insertAdjacentHTML"));
  assert.ok(js.includes("Promise.allSettled"));
  assert.ok(js.includes("localDateKey"));
});
