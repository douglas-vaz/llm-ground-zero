const http = require("node:http");
const { app, BrowserWindow } = require("electron");
const { startServer } = require("./server");
const { logError } = require("./log");

const VERSION = require("./package.json").version;
process.on("uncaughtException", (e) => logError("electron", e, { version: VERSION }));
process.on("unhandledRejection", (e) => logError("electron", e, { version: VERSION }));

const PORT = Number(process.env.LLM_GROUND_ZERO_PORT || 7788);

function isGroundZeroServer(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 2000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body).app === "llm-ground-zero"); }
        catch { resolve(false); }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

app.whenReady().then(async () => {
  try {
    await startServer(PORT);
  } catch (e) {
    // A headless Ground Zero server may already own the configured port. Do
    // not attach the Electron window to an unrelated local service.
    if (e.code !== "EADDRINUSE" || !await isGroundZeroServer(PORT)) throw e;
  }
  const dashboardUrl = `http://127.0.0.1:${PORT}`;
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "LLM Ground Zero",
    backgroundColor: "#0d1117",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(dashboardUrl + "/") && url !== dashboardUrl) event.preventDefault();
  });
  win.loadURL(dashboardUrl);
});

app.on("window-all-closed", () => app.quit());
