// Thin, typed-ish wrapper over the Kalshi Trade API v2 endpoints this app uses.
// Field names follow Kalshi's current fixed-point schema (`*_dollars`, `*_fp`).

import { toCents, toCount, toDollarString } from './money.js';

const API_PREFIX = '/trade-api/v2';

/** Kalshi's series of single-game NBA winner markets (one market per team). */
export const NBA_SERIES = 'KXNBAGAME';

export class KalshiError extends Error {
  constructor(message, { status = 0, code = '', cause } = {}) {
    super(message, { cause });
    this.name = 'KalshiError';
    this.status = status;
    this.code = code;
  }
}

function friendlyError(status, data) {
  const err = data?.error ?? data ?? {};
  const code = String(err.code ?? '');
  const detail = String(err.message || err.details || (typeof data === 'string' ? data : '') || '');
  if (status === 401) return 'Kalshi rejected your API key. Check the key ID, the private key, and Live vs Demo.';
  if (status === 429) return 'Kalshi is rate-limiting requests. Give it a second and try again.';
  if (/insufficient/i.test(`${code} ${detail}`)) return 'Not enough cash in your Kalshi account for this trade.';
  if (status >= 500) return 'Kalshi is having trouble right now. Try again in a moment.';
  if (detail) return detail.length > 160 ? `${detail.slice(0, 157)}…` : detail;
  return `Kalshi returned an error (${status}).`;
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class KalshiClient {
  /**
   * @param {{keyId:string, signer:{sign:(msg:string)=>Promise<string>}, env:'live'|'demo', send:Function}} opts
   */
  constructor({ keyId, signer, env = 'live', send }) {
    this.keyId = keyId;
    this.signer = signer;
    this.env = env;
    this.send = send;
  }

  async request(method, path, { query, body } = {}) {
    const fullPath = API_PREFIX + path;
    const timestamp = String(Date.now());
    const headers = {
      Accept: 'application/json',
      'KALSHI-ACCESS-KEY': this.keyId,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      // Kalshi signs timestamp + METHOD + path, with no query string.
      'KALSHI-ACCESS-SIGNATURE': await this.signer.sign(timestamp + method + fullPath),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await this.send({ env: this.env, method, path: fullPath, query, headers, body });
    } catch (cause) {
      throw new KalshiError("Can't reach Kalshi. Check your connection.", { cause });
    }
    if (res.status >= 200 && res.status < 300) return res.data ?? {};
    throw new KalshiError(friendlyError(res.status, res.data), { status: res.status, code: res.data?.error?.code });
  }

  async getBalanceCents() {
    const d = await this.request('GET', '/portfolio/balance');
    return d.balance ?? toCents(d.balance_dollars) ?? 0;
  }

  /** Open events in a series, each with its markets nested. */
  async listEvents(seriesTicker = NBA_SERIES) {
    const events = [];
    let cursor;
    for (let page = 0; page < 5; page++) {
      const d = await this.request('GET', '/events', {
        query: { series_ticker: seriesTicker, status: 'open', with_nested_markets: 'true', limit: 200, cursor },
      });
      events.push(...(d.events ?? []));
      cursor = d.cursor;
      if (!cursor) break;
    }
    return events;
  }

  async getEvent(eventTicker) {
    const d = await this.request('GET', `/events/${eventTicker}`, { query: { with_nested_markets: 'true' } });
    const event = d.event ?? {};
    if (!event.markets && d.markets) event.markets = d.markets;
    return event;
  }

  /**
   * Places a V2 order. `side: 'bid'` buys YES, `side: 'ask'` sells YES; the
   * price is always the YES price.
   */
  async placeOrder({ ticker, side, count, priceCents, timeInForce, reduceOnly = false }) {
    const d = await this.request('POST', '/portfolio/events/orders', {
      body: {
        ticker,
        client_order_id: uuid(),
        side,
        count: count.toFixed(2),
        price: toDollarString(priceCents),
        time_in_force: timeInForce,
        self_trade_prevention_type: 'taker_at_cross',
        ...(reduceOnly ? { reduce_only: true } : {}),
      },
    });
    return {
      id: d.order_id,
      filled: toCount(d.fill_count),
      remaining: toCount(d.remaining_count),
      avgPriceCents: toCents(d.average_fill_price),
      avgFeeCents: toCents(d.average_fee_paid),
    };
  }

  async getOrder(orderId) {
    const { order: o } = await this.request('GET', `/portfolio/orders/${orderId}`);
    return {
      id: o.order_id,
      status: o.status, // resting | canceled | executed
      filled: toCount(o.fill_count_fp),
      remaining: toCount(o.remaining_count_fp),
      priceCents: toCents(o.yes_price_dollars),
    };
  }

  async cancelOrder(orderId, ticker) {
    const d = await this.request('DELETE', `/portfolio/events/orders/${orderId}`, { query: { market_ticker: ticker } });
    return { reducedBy: toCount(d.reduced_by) };
  }

  /** Fills for one order, priced on the YES side. */
  async getFills(orderId) {
    const d = await this.request('GET', '/portfolio/fills', { query: { order_id: orderId, limit: 200 } });
    return (d.fills ?? []).map((f) => ({
      count: toCount(f.count_fp),
      priceCents: toCents(f.yes_price_dollars),
      feeCents: toCents(f.fee_cost) ?? 0,
    }));
  }
}
