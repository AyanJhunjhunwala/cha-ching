// Live market data over Kalshi's WebSocket API. Instead of asking for prices on
// a timer, the app subscribes once and Kalshi pushes every change:
//   ticker — best bid/ask and last price, sent whenever they move
//   trade  — every trade print
//   fill   — fills on your own orders (so a hit target shows instantly)

import { toCents, toCount } from './money.js';

export const WS_PATH = '/trade-api/ws/v2';

// Tried in order; a host that never opens is skipped on the next attempt.
export const WS_HOSTS = {
  live: ['wss://api.elections.kalshi.com', 'wss://external-api.kalshi.com'],
  demo: ['wss://demo-api.kalshi.co'],
};

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10000, 20000];
const MARKET_CHANNELS = ['ticker', 'trade'];

const tsMs = (ts) => (ts == null ? Date.now() : ts < 1e12 ? ts * 1000 : ts);

// Kalshi is moving to fixed-point dollar strings; accept either encoding.
function cents(msg, dollarsKey, centsKey) {
  if (msg[dollarsKey] != null) return toCents(msg[dollarsKey]);
  if (Number.isFinite(msg[centsKey])) return msg[centsKey];
  return undefined;
}

/** Normalized `ticker` message. Fields Kalshi didn't send are left undefined. */
export function parseTicker(msg) {
  const bid = cents(msg, 'yes_bid_dollars', 'yes_bid');
  const ask = cents(msg, 'yes_ask_dollars', 'yes_ask');
  const last = cents(msg, 'price_dollars', 'price') ?? cents(msg, 'last_price_dollars', 'last_price');
  return {
    ticker: msg.market_ticker,
    bid: bid === undefined ? undefined : bid > 0 ? bid : null,
    ask: ask === undefined ? undefined : ask > 0 && ask < 100 ? ask : null,
    last: last === undefined ? undefined : last || null,
    volume: msg.volume_fp != null ? toCount(msg.volume_fp) : msg.volume,
    ts: tsMs(msg.ts),
  };
}

/** Normalized `trade` message, priced on the YES side. */
export function parseTrade(msg) {
  return {
    ticker: msg.market_ticker,
    price: cents(msg, 'yes_price_dollars', 'yes_price') ?? null,
    count: msg.count_fp != null ? toCount(msg.count_fp) : (msg.count ?? 0),
    ts: tsMs(msg.ts),
  };
}

/** Normalized `fill` message for one of your orders. */
export function parseFill(msg) {
  return {
    orderId: msg.order_id,
    ticker: msg.market_ticker ?? msg.ticker,
    count: msg.count_fp != null ? toCount(msg.count_fp) : (msg.count ?? 0),
  };
}

export class KalshiStream {
  /**
   * @param {object} opts
   * @param {string} opts.keyId
   * @param {{sign:(msg:string)=>Promise<string>}} opts.signer
   * @param {'live'|'demo'} opts.env
   * @param {(args:{url:string, headers:object, onOpen:Function, onMessage:Function, onClose:Function}) =>
   *   ({send:(text:string)=>void, close:()=>void} | null)} opts.connect
   *   Opens a socket and returns its handle right away (null when this runtime
   *   can't stream). Callbacks must fire asynchronously.
   */
  // Timer defaults are wrapped: browsers throw "Illegal invocation" if
  // setTimeout is called as a method of another object.
  constructor({ keyId, signer, env, connect, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) }) {
    Object.assign(this, { keyId, signer, env, connectSocket: connect, setTimer, clearTimer });
    this.status = 'idle'; // idle | connecting | live | reconnecting | unsupported
    this.listeners = new Map();
    this.markets = [];
    this.socket = null;
    this.nextId = 1;
    this.attempt = 0;
    this.hostIndex = 0;
    this.lastMessageAt = 0;
    this.resetSubscriptions();
  }

  resetSubscriptions() {
    this.marketSids = [];
    this.marketGeneration = 0;
    this.pending = new Map(); // command id -> market generation (or 'fill')
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    this.emit('status', status);
  }

  get streaming() {
    return this.status === 'live';
  }

  start() {
    if (this.status !== 'idle') return;
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    this.clearTimer(this.retryTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.resetSubscriptions();
    this.setStatus('idle');
  }

  /** Retry right away (e.g. the app came back to the foreground) instead of waiting out the backoff. */
  wake() {
    if (this.status !== 'reconnecting' || this.stopped) return;
    this.clearTimer(this.retryTimer);
    this.open();
  }

  async open() {
    this.setStatus(this.attempt ? 'reconnecting' : 'connecting');
    const hosts = WS_HOSTS[this.env];
    const url = hosts[this.hostIndex % hosts.length] + WS_PATH;
    let headers;
    try {
      const timestamp = String(Date.now());
      headers = {
        'KALSHI-ACCESS-KEY': this.keyId,
        'KALSHI-ACCESS-TIMESTAMP': timestamp,
        'KALSHI-ACCESS-SIGNATURE': await this.signer.sign(timestamp + 'GET' + WS_PATH),
      };
    } catch {
      return this.scheduleReconnect();
    }
    if (this.stopped) return;

    // Transports return their handle synchronously and only call back later,
    // so `socket` is always assigned before any of these run.
    let opened = false;
    let socket;
    try {
      socket = this.connectSocket({
        url,
        headers,
        onOpen: () => {
          if (this.socket !== socket) return;
          opened = true;
          this.attempt = 0;
          this.setStatus('live');
          this.subscribeFills();
          this.subscribeMarkets();
        },
        onMessage: (text) => this.socket === socket && this.handle(text),
        onClose: () => {
          if (this.socket !== socket) return;
          this.socket = null;
          if (!opened) this.hostIndex++; // try the next host next time
          this.scheduleReconnect();
        },
      });
    } catch {
      this.hostIndex++;
      return this.scheduleReconnect();
    }
    if (!socket) return this.setStatus('unsupported');
    this.socket = socket;
  }

  scheduleReconnect() {
    this.resetSubscriptions();
    if (this.stopped) return;
    this.setStatus('reconnecting');
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt++;
    this.retryTimer = this.setTimer(() => this.open(), delay);
  }

  send(cmd, params) {
    const id = this.nextId++;
    this.socket?.send(JSON.stringify({ id, cmd, params }));
    return id;
  }

  subscribeFills() {
    this.pending.set(this.send('subscribe', { channels: ['fill'] }), 'fill');
  }

  /** Watch these market tickers for price and trade updates (replaces the previous set). */
  setMarkets(tickers) {
    const next = [...new Set(tickers)].sort();
    if (next.join() === this.markets.join()) return;
    this.markets = next;
    if (this.streaming) this.subscribeMarkets();
  }

  subscribeMarkets() {
    if (this.marketSids.length) this.send('unsubscribe', { sids: this.marketSids });
    this.marketSids = [];
    this.marketGeneration++;
    if (!this.markets.length) return;
    const id = this.send('subscribe', { channels: MARKET_CHANNELS, market_tickers: this.markets });
    this.pending.set(id, this.marketGeneration);
  }

  handle(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    this.lastMessageAt = Date.now();
    const msg = data.msg ?? {};
    switch (data.type) {
      case 'subscribed': {
        const sid = msg.sid ?? data.sid;
        const owner = this.pending.get(data.id);
        if (owner === 'fill' || sid == null) return;
        // A reply for a market set we've since replaced: drop it right away.
        if (owner !== this.marketGeneration) this.send('unsubscribe', { sids: [sid] });
        else this.marketSids.push(sid);
        return;
      }
      case 'ticker':
        return this.emit('ticker', parseTicker(msg));
      case 'trade':
        return this.emit('trade', parseTrade(msg));
      case 'fill':
        return this.emit('fill', parseFill(msg));
      case 'error':
        return this.emit('error', { code: msg.code, message: msg.msg ?? msg.message ?? 'WebSocket error' });
      default:
    }
  }
}
