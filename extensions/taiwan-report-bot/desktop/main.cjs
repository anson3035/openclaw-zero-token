// Electron desktop wrapper for the Taiwan Violation Reporting bot.
// Spawns the API server as a child process and opens a BrowserWindow
// pointing at it. Single window, no menu chrome beyond the basics.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");

// Chromium refuses to launch its renderer sandbox under uid 0 (Docker /
// CI containers). In production builds users are non-root, so this is
// a no-op there.
if (process.getuid && process.getuid() === 0) {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
}

const PORT = Number(process.env.HTTP_PORT || 8787);
let apiProc = null;

function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`API server did not start on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(tick, 200);
        }
      });
    };
    tick();
  });
}

function startApi() {
  const repoRoot = path.resolve(__dirname, "..");
  apiProc = spawn(
    process.execPath,
    ["--import", "tsx", path.join(repoRoot, "src/server.ts")],
    {
      cwd: repoRoot,
      env: { ...process.env, HTTP_PORT: String(PORT), RUN: "api" },
      stdio: "inherit",
    },
  );
  apiProc.on("exit", (code) => {
    console.log(`[api] exited with code ${code}`);
    if (!app.isQuiting) app.quit();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "台灣違規檢舉系統",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // open external links (including sms: deep links) in the system shell
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  await win.loadURL(`http://127.0.0.1:${PORT}/`);
}

app.whenReady().then(async () => {
  startApi();
  try {
    await waitForPort(PORT);
  } catch (err) {
    console.error(err);
    app.quit();
    return;
  }
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.isQuiting = true;
  if (apiProc) {
    try {
      apiProc.kill("SIGTERM");
    } catch {}
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuiting = true;
  if (apiProc) {
    try {
      apiProc.kill("SIGTERM");
    } catch {}
  }
});
