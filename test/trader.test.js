import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KalshiClient, KalshiError } from '../src/kalshi/client.js';
import { held, planEntry, realizedPnl, targetFor, Trader, TradeError } from '../src/trader.js';

const EVENT = 'KXNBAGAME-25OCT21HOUOKC';
const HOU = `${EVENT}-HOU`;
const CENT_TICKS = [{ start: '0.0000', end: '1.0000', step: '0.0100' }];
const SETTINGS = { stakeDollars: 5, takeProfitCents: 5, slippageCents: 2 };

/** In-memory stand-in for KalshiClient that behaves like a simple book. */
class FakeExchange {
  constructor({ bid = 40, ask = 42 } = {}) {
    this.bid = bid;
    this.ask = ask;
    this.status = 'active';
    this.orders = new Map();
    this.placed = [];
    this.canceled = [];
    this.buyFillRatio = 1;
    this.seq = 0;
  }

  async getEvent() {
    const d = (c) => (c == null ? '0.0000' : (c / 100).toFixed(4));
    return {
      event_ticker: EVENT,
      markets: [
        { ticker: HOU, status: this.status, yes_bid_dollars: d(this.bid), yes_ask_dollars: d(this.ask), price_ranges: CENT_TICKS },
        { ticker: `${EVENT}-OKC`, status: this.status, yes_bid_dollars: '0.5700', yes_ask_dollars: '0.5900', price_ranges: CENT_TICKS },
      ],
    };
  }

  async placeOrder(req) {
    this.placed.push(req);
    const id = `ord-${++this.seq}`;
    let filled = 0;
    let price = req.priceCents;
    if (req.side === 'bid' && this.ask != null && req.priceCents >= this.ask) {
      filled = Math.floor(req.count * this.buyFillRatio);
      price = this.ask;
    } else if (req.side === 'ask' && this.bid != null && req.priceCents <= this.bid) {
      filled = req.count;
      price = this.bid;
    }
    const resting = req.timeInForce === 'good_till_canceled' && filled < req.count;
    this.orders.set(id, { id, status: resting ? 'resting' : filled === req.count ? 'executed' : 'canceled', filled, count: req.count, price });
    return { id, filled, remaining: resting ? req.count - filled : 0, avgPriceCents: filled ? price : null, avgFeeCents: filled ? 1 : null };
  }

  /** Simulates the market trading up through a resting order. */
  fillResting(id) {
    const o = this.orders.get(id);
    o.filled = o.count;
    o.status = 'executed';
  }

  async getOrder(id) {
    const o = this.orders.get(id);
    return { id, status: o.status, filled: o.filled, remaining: o.count - o.filled, priceCents: o.price };
  }

  async cancelOrder(id) {
    this.canceled.push(id);
    const o = this.orders.get(id);
    if (o.status !== 'resting') throw new KalshiError('Order not found', { status: 404 });
    o.status = 'canceled';
    return { reducedBy: o.count - o.filled };
  }

  async getFills(id) {
    const o = this.orders.get(id);
    return o.filled ? [{ count: o.filled, priceCents: o.price, feeCents: 1 }] : [];
  }
}

class MemoryStore {
  constructor() {
    this.trades = [];
  }
  save(t) {
    if (!this.trades.includes(t)) this.trades.push(t);
  }
}

const side = { ticker: HOU, code: 'HOU', name: 'Rockets', color: '#CE1141' };

function setup(opts) {
  const exchange = new FakeExchange(opts);
  const store = new MemoryStore();
  return { exchange, store, trader: new Trader({ client: exchange, store }) };
}

test('planEntry sizes the order from the stake and caps the price with slippage', () => {
  assert.deepEqual(planEntry({ askCents: 42, stakeCents: 500, takeProfitCents: 5, slippageCents: 2, priceRanges: CENT_TICKS }), { limitCents: 44, count: 11 });
  const codeOf = (args) => {
    try {
      planEntry({ stakeCents: 500, takeProfitCents: 5, slippageCents: 2, priceRanges: CENT_TICKS, ...args });
    } catch (err) {
      assert.ok(err instanceof TradeError);
      return err.code;
    }
  };
  assert.equal(codeOf({ askCents: null }), 'no_ask');
  assert.equal(codeOf({ askCents: 96 }), 'no_room');
  assert.equal(codeOf({ askCents: 60, stakeCents: 50 }), 'stake_low');
});

test('targetFor rounds up onto the tick grid and never passes 99¢', () => {
  assert.equal(targetFor({ entryCents: 41.5, takeProfitCents: 5, priceRanges: CENT_TICKS }), 47);
  assert.equal(targetFor({ entryCents: 97, takeProfitCents: 5, priceRanges: CENT_TICKS }), 99);
  const tenths = [{ start: '0.0000', end: '1.0000', step: '0.0010' }];
  assert.equal(targetFor({ entryCents: 41.25, takeProfitCents: 5, priceRanges: tenths }), 46.3);
});

test('favor buys at the current price and rests a sell at entry + threshold', async () => {
  const { exchange, store, trader } = setup({ bid: 40, ask: 42 });
  const trade = await trader.favor({ eventTicker: EVENT, side, settings: SETTINGS });

  const [buy, sell] = exchange.placed;
  assert.deepEqual(buy, { ticker: HOU, side: 'bid', count: 11, priceCents: 44, timeInForce: 'immediate_or_cancel' });
  assert.deepEqual(sell, { ticker: HOU, side: 'ask', count: 11, priceCents: 47, timeInForce: 'good_till_canceled' });
  assert.equal(trade.entryCents, 42);
  assert.equal(trade.targetCents, 47);
  assert.equal(trade.status, 'open');
  assert.equal(trade.entryFeeCents, 11);
  assert.equal(store.trades.length, 1);
});

test('refresh marks the trade done once the target fills', async () => {
  const { exchange, trader } = setup();
  const trade = await trader.favor({ eventTicker: EVENT, side, settings: SETTINGS });
  await trader.refresh(trade);
  assert.equal(trade.status, 'open');

  exchange.fillResting(trade.sellOrderId);
  await trader.refresh(trade);
  assert.equal(trade.status, 'done');
  assert.equal(held(trade), 0);
  assert.equal(realizedPnl(trade), 11 * 5);
});

test('nothing is recorded when the buy does not fill', async () => {
  const { exchange, store, trader } = setup();
  exchange.buyFillRatio = 0;
  await assert.rejects(trader.favor({ eventTicker: EVENT, side, settings: SETTINGS }), /price moved/);
  assert.equal(store.trades.length, 0);
  assert.equal(exchange.placed.length, 1);
});

test('a partial buy lists only what was bought', async () => {
  const { exchange, trader } = setup();
  exchange.buyFillRatio = 0.5;
  const trade = await trader.favor({ eventTicker: EVENT, side, settings: SETTINGS });
  assert.equal(trade.count, 5);
  assert.equal(exchange.placed[1].count, 5);
});

test('paused markets and missing sellers are refused before any order', async () => {
  const paused = setup();
  paused.exchange.status = 'inactive';
  await assert.rejects(paused.trader.favor({ eventTicker: EVENT, side, settings: SETTINGS }), /paused/);

  const empty = setup({ ask: null });
  await assert.rejects(empty.trader.favor({ eventTicker: EVENT, side, settings: SETTINGS }), (err) => err.code === 'no_ask');
  assert.equal(paused.exchange.placed.length + empty.exchange.placed.length, 0);
});

test('if the sell order fails the trade is kept and can be re-listed', async () => {
  const { exchange, store, trader } = setup();
  const place = exchange.placeOrder.bind(exchange);
  exchange.placeOrder = async (req) => {
    if (req.side === 'ask') {
      exchange.placeOrder = place;
      throw new KalshiError('Exchange is closed', { status: 400 });
    }
    return place(req);
  };
  const stuck = await trader.favor({ eventTicker: EVENT, side, settings: SETTINGS });
  assert.equal(stuck.status, 'unprotected');
  assert.match(stuck.note, /Exchange is closed/);
  assert.equal(store.trades.length, 1);

  await trader.placeTarget(stuck);
  assert.equal(stuck.status, 'open');
  assert.equal(stuck.note, '');
});

test('a target that is already below the bid fills immediately', async () => {
  const { exchange, trader } = setup({ bid: 40, ask: 42 });
  const original = exchange.placeOrder.bind(exchange);
  exchange.placeOrder = async (req) => {
    if (req.side === 'ask') exchange.bid = 50; // big run between the buy and the sell
    return original(req);
  };
  const trade = await trader.favor({ eventTicker: EVENT, side, settings: SETTINGS });
  assert.equal(trade.status, 'done');
  assert.equal(realizedPnl(trade), 11 * (50 - 42));
});

test('target canceled outside the app leaves the trade needing attention', async () => {
  const { exchange, trader } = setup();
  const trade = await trader.favor({ eventTicker: EVENT, side, settings: SETTINGS });
  exchange.orders.get(trade.sellOrderId).status = 'canceled';
  await trader.refresh(trade);
  assert.equal(trade.status, 'unprotected');
  assert.equal(held(trade), 11);
});

test('sell now cancels the target and sells at the bid minus slippage', async () => {
  const { exchange, trader } = setup({ bid: 40, ask: 42 });
  const trade = await trader.favor({ eventTicker: EVENT, side, settings: SETTINGS });
  exchange.bid = 44;
  await trader.sellNow(trade, SETTINGS);

  assert.deepEqual(exchange.canceled, ['ord-2']);
  assert.deepEqual(exchange.placed.at(-1), { ticker: HOU, side: 'ask', count: 11, priceCents: 42, timeInForce: 'immediate_or_cancel', reduceOnly: true });
  assert.equal(trade.status, 'done');
  assert.equal(realizedPnl(trade), 11 * 2);
});

test('sell now with no buyers keeps the position and explains why', async () => {
  const { exchange, trader } = setup();
  const trade = await trader.favor({ eventTicker: EVENT, side, settings: SETTINGS });
  exchange.bid = null;
  await assert.rejects(trader.sellNow(trade, SETTINGS), /No buyers/);
  assert.equal(trade.status, 'unprotected');
  assert.equal(held(trade), 11);
});

test('sell now after the target already filled just records the win', async () => {
  const { exchange, trader } = setup();
  const trade = await trader.favor({ eventTicker: EVENT, side, settings: SETTINGS });
  exchange.fillResting(trade.sellOrderId);
  await trader.sellNow(trade, SETTINGS);
  assert.equal(trade.status, 'done');
  assert.equal(exchange.placed.length, 2);
  assert.equal(realizedPnl(trade), 55);
});

test('KalshiClient sends the V2 order shape and signs the bare path', async () => {
  const sent = [];
  const signed = [];
  const client = new KalshiClient({
    keyId: 'key-123',
    env: 'demo',
    signer: { sign: async (msg) => (signed.push(msg), 'sig==') },
    send: async (req) => {
      sent.push(req);
      return { status: 201, data: { order_id: 'o1', fill_count: '11.00', remaining_count: '0.00', average_fill_price: '0.4200', average_fee_paid: '0.0100' } };
    },
  });
  const res = await client.placeOrder({ ticker: HOU, side: 'bid', count: 11, priceCents: 44, timeInForce: 'immediate_or_cancel' });
  assert.deepEqual(res, { id: 'o1', filled: 11, remaining: 0, avgPriceCents: 42, avgFeeCents: 1 });

  const [req] = sent;
  assert.equal(req.method, 'POST');
  assert.equal(req.path, '/trade-api/v2/portfolio/events/orders');
  assert.equal(req.env, 'demo');
  const { client_order_id, ...body } = req.body;
  assert.match(client_order_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(body, { ticker: HOU, side: 'bid', count: '11.00', price: '0.4400', time_in_force: 'immediate_or_cancel', self_trade_prevention_type: 'taker_at_cross' });
  assert.equal(req.headers['KALSHI-ACCESS-KEY'], 'key-123');
  assert.equal(req.headers['KALSHI-ACCESS-SIGNATURE'], 'sig==');
  assert.equal(signed[0], `${req.headers['KALSHI-ACCESS-TIMESTAMP']}POST/trade-api/v2/portfolio/events/orders`);

  await client.cancelOrder('o1', HOU).catch(() => {});
  assert.equal(sent[1].method, 'DELETE');
  assert.deepEqual(sent[1].query, { market_ticker: HOU });
  assert.ok(signed[1].endsWith('DELETE/trade-api/v2/portfolio/events/orders/o1'), 'query string must not be signed');
});

test('KalshiClient turns HTTP failures into readable errors', async () => {
  const make = (status, data) => new KalshiClient({ keyId: 'k', signer: { sign: async () => 's' }, send: async () => ({ status, data }) });
  await assert.rejects(make(401, {}).getBalanceCents(), /rejected your API key/);
  await assert.rejects(make(400, { error: { code: 'insufficient_balance', message: 'insufficient balance' } }).getBalanceCents(), /Not enough cash/);
  await assert.rejects(make(400, { error: { message: 'invalid price' } }).getBalanceCents(), /invalid price/);
  const offline = new KalshiClient({ keyId: 'k', signer: { sign: async () => 's' }, send: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.getBalanceCents(), /Can't reach Kalshi/);
  assert.equal(await make(200, { balance: 12345, balance_dollars: '123.45' }).getBalanceCents(), 12345);
});
