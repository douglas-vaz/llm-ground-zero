const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const staticDir = path.join(__dirname, "..", "static");

test("frontend uses local assets and safe DOM rendering", () => {
  const html = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(staticDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(staticDir, "styles.css"), "utf8");
  // The base button rule sets display, which beats the UA [hidden] style —
  // without this rule, hidden buttons (install, repair) stay visible.
  assert.ok(css.includes("button[hidden] { display: none; }"));
  assert.ok(html.includes('src="/vendor/chart.umd.js"'));
  assert.ok(!html.includes("https://"));
  assert.ok(!js.includes("innerHTML"));
  assert.ok(!js.includes("insertAdjacentHTML"));
  assert.ok(js.includes("Promise.allSettled"));
  assert.ok(js.includes("localDateKey"));
  assert.ok(html.includes('data-view="overview"'));
  assert.ok(html.includes('data-view="usage"'));
  assert.ok(html.includes('data-view="savings"'));
  assert.ok(html.includes('id="outcomeDialog"'));
  assert.ok(html.includes('id="settingsDialog"'));
  assert.ok(html.includes('id="headroomInstall"'));
  assert.ok(html.includes('id="headroomMonitorStatus"'));
  assert.ok(html.includes('id="headroomRepair"'));
  assert.ok(js.includes('/api/headroom/install'));
  assert.ok(js.includes('setInterval(monitorHeadroom, 15000)'));
  assert.ok(js.includes("headroomBusy"), "monitor must yield to in-flight operations");
  assert.ok(js.includes("Applying the Headroom agent setup"), "apply must show progress feedback");
  assert.ok(!js.includes("setup.sh"), "UI must point at the in-app installer");
  assert.ok(js.includes('byId("subscriptionRows").replaceChildren(...rows)'));
  assert.ok(!js.includes("rows.length ? rows : [subscriptionRow()]"));
  assert.ok(js.includes('"X-LLM-Ground-Zero-Action": "1"'));
  assert.ok(js.includes("navigator.clipboard.writeText"));
  assert.ok(!html.includes("onclick="));
});

test("electron package includes advisor runtime modules", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(pkg.build.files.includes("advisor/**"));
  assert.ok(pkg.build.files.includes("integrations/**"));
});
