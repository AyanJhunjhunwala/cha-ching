// Desktop shell. The renderer is the same web app that ships to iPhone; this
// process only forwards signed requests to Kalshi, holds the live-data
// WebSocket (browser sockets can't send Kalshi's auth headers), and keeps the
// API key encrypted with the OS keychain.

const { app, BrowserWindow, ipcMain, net, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

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

const sockets = new Map();
let socketSeq = 0;

ipcMain.handle('socket:open', (event, { url, headers }) => {
  const target = new URL(url);
  if (target.protocol !== 'wss:' || !KALSHI_HOSTS.has(target.hostname)) {
    throw new Error(`Blocked WebSocket to ${target.hostname}`);
  }
  const id = ++socketSeq;
  const ws = new WebSocket(target, { headers, handshakeTimeout: 10000 });
  const emit = (type, data) => {
    if (!event.sender.isDestroyed()) event.sender.send('socket:event', { id, type, data });
  };
  ws.on('open', () => emit('open'));
  ws.on('message', (data) => emit('message', data.toString()));
  ws.on('error', () => {}); // a 'close' always follows
  ws.on('close', () => {
    sockets.delete(id);
    emit('close');
  });
  sockets.set(id, ws);
  return id;
});

ipcMain.handle('socket:send', (_event, { id, data }) => {
  const ws = sockets.get(id);
  if (ws?.readyState === WebSocket.OPEN) ws.send(data);
});

ipcMain.handle('socket:close', (_event, { id }) => sockets.get(id)?.close());

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
