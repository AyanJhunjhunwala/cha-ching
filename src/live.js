// A short rolling record of each market's price and trade activity, used to
// show that a game is moving: sparklines, "▲ 4¢ in 5m", trades per minute and
// how long ago the price last moved. Fed by WebSocket ticks, or by REST
// snapshots when the socket is down.

const WINDOW_MS = 10 * 60_000;
const MIN_HISTORY_MS = 60_000;
const MAX_POINTS = 600; // per market, so a frantic game can't grow memory unbounded

/** The price shown on screen for a market: the buy price, else the last trade. */
export const displayPrice = (q) => q.ask ?? q.last ?? null;

export class LiveTape {
  constructor({ windowMs = WINDOW_MS } = {}) {
    this.windowMs = windowMs;
    this.quotes = new Map(); // ticker -> latest {bid, ask, last}
    this.points = new Map(); // ticker -> [{t, price}] (changes only)
    this.trades = new Map(); // ticker -> [{t, count}]
  }

  has(ticker) {
    return this.points.has(ticker);
  }

  /** Merge a (possibly partial) quote and record the displayed price if it changed. */
  recordQuote(ticker, quote, t = Date.now()) {
    const merged = { ...this.quotes.get(ticker) };
    for (const k of ['bid', 'ask', 'last']) if (quote[k] !== undefined) merged[k] = quote[k];
    this.quotes.set(ticker, merged);
    const price = displayPrice(merged);
    if (price == null) return;
    const points = this.points.get(ticker) ?? [];
    if (points.at(-1)?.price !== price) points.push({ t, price });
    const kept = this.prune(points, t);
    this.points.set(ticker, kept.length > MAX_POINTS ? kept.slice(-MAX_POINTS) : kept);
  }

  recordTrade(ticker, count, t = Date.now()) {
    const trades = (this.trades.get(ticker) ?? []).filter((x) => x.t > t - 60_000);
    trades.push({ t, count });
    this.trades.set(ticker, trades);
  }

  // Keep everything inside the window plus the last point before it (the baseline).
  prune(points, now) {
    const cutoff = now - this.windowMs;
    let first = points.findIndex((p) => p.t >= cutoff);
    if (first === -1) first = points.length;
    return points.slice(Math.max(0, first - 1));
  }

  /** Step series over the window, ending at `now`, for a sparkline. */
  series(ticker, now = Date.now()) {
    const points = this.prune(this.points.get(ticker) ?? [], now);
    if (!points.length) return [];
    const start = now - this.windowMs;
    const out = points.map((p) => ({ t: Math.max(p.t, start), price: p.price }));
    out.push({ t: now, price: points.at(-1).price });
    return out;
  }

  /**
   * Price change over the last `spanMs` (or over the history we have, if it
   * covers at least a minute). @returns {{delta:number, minutes:number}|null}
   */
  change(ticker, spanMs = 5 * 60_000, now = Date.now()) {
    const points = this.points.get(ticker) ?? [];
    if (!points.length || now - points[0].t < MIN_HISTORY_MS) return null;
    const from = now - spanMs;
    const base = points.findLast((p) => p.t <= from) ?? points[0];
    const minutes = Math.max(1, Math.round((now - Math.max(base.t, from)) / 60_000));
    return { delta: Math.round((points.at(-1).price - base.price) * 10) / 10, minutes };
  }

  /** Trade prints in the last minute across these markets. */
  tradesPerMinute(tickers, now = Date.now()) {
    return tickers.reduce((n, t) => n + (this.trades.get(t) ?? []).filter((x) => x.t > now - 60_000).length, 0);
  }

  /** When the displayed price of any of these markets last changed (ms epoch), or null. */
  lastMove(tickers) {
    const times = tickers.map((t) => this.points.get(t)?.at(-1)?.t).filter(Boolean);
    return times.length ? Math.max(...times) : null;
  }
}

export function formatAge(ms) {
  if (ms < 1500) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export function formatMove(change) {
  if (!change) return null;
  const { delta, minutes } = change;
  if (delta === 0) return { text: `flat · ${minutes}m`, dir: 'flat' };
  const amount = Number.isInteger(delta) ? Math.abs(delta) : Math.abs(delta).toFixed(1);
  return { text: `${delta > 0 ? '▲' : '▼'} ${amount}¢ · ${minutes}m`, dir: delta > 0 ? 'up' : 'down' };
}
