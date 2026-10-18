// Opens Kalshi WebSocket connections. Kalshi authenticates the handshake with
// KALSHI-ACCESS-* headers, which the browser/WebView WebSocket API can't send,
// so each runtime gets there differently:
//   iPhone (Capacitor): native URLSessionWebSocketTask plugin (ios/App/App/KalshiSocketPlugin.swift)
//   Desktop (Electron): main-process `ws` client via the preload bridge
//   Browser (vite dev): the dev server proxy moves the signed values into headers
// Every transport returns its handle synchronously and calls back later.

import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeSocket = registerPlugin('KalshiSocket');

// Matches the /kalshi-ws/* proxies in vite.config.js.
const DEV_PROXY_PATHS = {
  'api.elections.kalshi.com': '/kalshi-ws/elections',
  'external-api.kalshi.com': '/kalshi-ws/external',
  'demo-api.kalshi.co': '/kalshi-ws/demo',
};

/**
 * A socket that lives on the other side of a bridge (Electron main process or
 * native iOS code) and is addressed by an id the bridge hands back. Sends made
 * before the id arrives are queued; events that beat the id are replayed.
 */
function bridgedSocket({ subscribe, open, send, close }, { onOpen, onMessage, onClose }) {
  let id = null;
  let closed = false;
  let finished = false;
  const queue = [];
  const early = [];

  const finish = () => {
    if (finished) return;
    finished = true;
    unsubscribe();
    onClose();
  };
  const dispatch = (event) => {
    if (event.type === 'open') onOpen();
    else if (event.type === 'message') onMessage(event.data);
    else if (event.type === 'close') finish();
  };
  const unsubscribe = subscribe((event) => {
    if (id == null) early.push(event);
    else if (event.id === id) dispatch(event);
  });

  open().then(
    (newId) => {
      id = newId;
      early.splice(0).filter((e) => e.id === id).forEach(dispatch);
      if (closed) return close(id);
      queue.splice(0).forEach((text) => send(id, text));
    },
    () => setTimeout(finish), // refused: report a close so the stream retries
  );

  return {
    send: (text) => (id == null ? queue.push(text) : send(id, text)),
    close: () => {
      closed = true;
      if (id != null) close(id);
    },
  };
}

function electronSocket({ url, headers, ...callbacks }) {
  const bridge = window.chaching;
  return bridgedSocket({
    subscribe: (cb) => bridge.onSocketEvent(cb),
    open: () => bridge.socketOpen({ url, headers }),
    send: (id, data) => bridge.socketSend({ id, data }),
    close: (id) => bridge.socketClose({ id }),
  }, callbacks);
}

function nativeSocket({ url, headers, ...callbacks }) {
  return bridgedSocket({
    subscribe: (cb) => {
      const subs = ['open', 'message', 'close'].map((type) => NativeSocket.addListener(type, (e) => cb({ ...e, type })));
      return () => subs.forEach((p) => p.then((s) => s.remove()));
    },
    open: () => NativeSocket.connect({ url, headers }).then((r) => r.id),
    send: (id, data) => NativeSocket.send({ id, data }).catch(() => {}),
    close: (id) => NativeSocket.close({ id }).catch(() => {}),
  }, callbacks);
}

function devProxySocket({ url, headers, onOpen, onMessage, onClose }) {
  const path = DEV_PROXY_PATHS[new URL(url).hostname];
  if (!path) return null;
  const params = new URLSearchParams({
    key: headers['KALSHI-ACCESS-KEY'],
    ts: headers['KALSHI-ACCESS-TIMESTAMP'],
    sig: headers['KALSHI-ACCESS-SIGNATURE'],
  });
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}${path}?${params}`);
  ws.onopen = () => onOpen();
  ws.onmessage = (e) => typeof e.data === 'string' && onMessage(e.data);
  ws.onclose = () => onClose();
  return {
    send: (text) => ws.readyState === WebSocket.OPEN && ws.send(text),
    close: () => ws.close(),
  };
}

/** @returns a socket handle, or null when this runtime can't stream (the app then polls). */
export function connectSocket(args) {
  if (typeof window !== 'undefined' && window.chaching?.socketOpen) return electronSocket(args);
  if (Capacitor.isNativePlatform()) return Capacitor.isPluginAvailable('KalshiSocket') ? nativeSocket(args) : null;
  if (import.meta.env?.DEV) return devProxySocket(args);
  return null;
}
