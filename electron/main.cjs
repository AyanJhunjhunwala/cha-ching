// Desktop shell. The renderer is the same web app that ships to iPhone; this
// process only forwards signed requests to Kalshi and keeps the API key
// encrypted with the OS keychain.

const { app, BrowserWindow, ipcMain, net, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const KALSHI_HOSTS = new Set(['external-api.kalshi.com', 'api.elections.kalshi.com', 'demo-api.kalshi.co']);
const credsFile = () => path.join(app.getPath('userData'), 'kalshi-key.bin');

function createWindow() {
  const win = new BrowserWindow({
    width: 430,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    title: 'Cha-Ching',
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('kalshi:request', async (_event, { url, method, headers, body }) => {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !KALSHI_HOSTS.has(target.hostname)) {
    throw new Error(`Blocked request to ${target.hostname}`);
  }
  const res = await net.fetch(target.toString(), { method, headers, body });
  return { status: res.status, data: await res.text() };
});

ipcMain.handle('secure:get', () => {
  try {
    const data = fs.readFileSync(credsFile());
    return safeStorage.decryptString(data);
  } catch {
    return null;
  }
});

ipcMain.handle('secure:set', (_event, value) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  fs.writeFileSync(credsFile(), safeStorage.encryptString(value), { mode: 0o600 });
  return true;
});

ipcMain.handle('secure:clear', () => {
  fs.rmSync(credsFile(), { force: true });
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
