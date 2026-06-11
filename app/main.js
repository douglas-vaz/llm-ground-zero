const { app, BrowserWindow } = require("electron");
const { startServer } = require("./server");
const { logError } = require("./log");

const VERSION = require("./package.json").version;
process.on("uncaughtException", (e) => logError("electron", e, { version: VERSION }));
process.on("unhandledRejection", (e) => logError("electron", e, { version: VERSION }));

const PORT = Number(process.env.LLM_GROUND_ZERO_PORT || 7788);

app.whenReady().then(async () => {
  try {
    await startServer(PORT);
  } catch (e) {
    if (e.code !== "EADDRINUSE") throw e; // headless server already running → just attach
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "LLM Ground Zero",
    backgroundColor: "#0d1117",
  });
  win.loadURL(`http://127.0.0.1:${PORT}`);
});

app.on("window-all-closed", () => app.quit());
