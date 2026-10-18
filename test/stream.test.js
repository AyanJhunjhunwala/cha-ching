import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KalshiStream, parseFill, parseTicker, parseTrade } from '../src/kalshi/stream.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness({ env = 'live', unsupported = false } = {}) {
  const sockets = [];
  const timers = [];
  const connect = (args) => {
    if (unsupported) return null;
    const socket = {
      args,
      sent: [],
      closed: false,
      send(text) {
        this.sent.push(JSON.parse(text));
      },
      close() {
        this.closed = true;
      },
      open: () => args.onOpen(),
      drop: () => args.onClose(),
      receive: (data) => args.onMessage(JSON.stringify(data)),
    };
    sockets.push(socket);
    return socket;
  };
  const stream = new KalshiStream({
    keyId: 'key-1',
    signer: { sign: async (msg) => `sig(${msg})` },
    env,
    connect,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => {},
  });
  const statuses = [];
  stream.on('status', (s) => statuses.push(s));
  return { stream, sockets, timers, statuses };
}

test('connects with a signed handshake on the WebSocket path', async () => {
  const { stream, sockets, statuses } = harness();
  stream.start();
  await tick();
  const [socket] = sockets;
  assert.equal(socket.args.url, 'wss://api.elections.kalshi.com/trade-api/ws/v2');
  const h = socket.args.headers;
  assert.equal(h['KALSHI-ACCESS-KEY'], 'key-1');
  assert.equal(h['KALSHI-ACCESS-SIGNATURE'], `sig(${h['KALSHI-ACCESS-TIMESTAMP']}GET/trade-api/ws/v2)`);
  assert.deepEqual(statuses, ['connecting']);

  socket.open();
  assert.equal(stream.status, 'live');
});

test('subscribes to fills and to price + trade updates for the watched markets', async () => {
  const { stream, sockets } = harness();
  stream.setMarkets(['B-2', 'A-1', 'A-1']);
  stream.start();
  await tick();
  sockets[0].open();
  const [fill, markets] = sockets[0].sent;
  assert.deepEqual(fill.params, { channels: ['fill'] });
  assert.equal(markets.cmd, 'subscribe');
  assert.deepEqual(markets.params, { channels: ['ticker', 'trade'], market_tickers: ['A-1', 'B-2'] });
});

test('switching markets unsubscribes the old ones first', async () => {
  const { stream, sockets } = harness();
  stream.setMarkets(['A-1']);
  stream.start();
  await tick();
  const s = sockets[0];
  s.open();
  const subId = s.sent[1].id;
  s.receive({ id: subId, type: 'subscribed', msg: { channel: 'ticker', sid: 7 } });
  s.receive({ id: subId, type: 'subscribed', msg: { channel: 'trade', sid: 8 } });

  stream.setMarkets(['C-3', 'D-4']);
  assert.deepEqual(s.sent.slice(-2).map((m) => [m.cmd, m.params]), [
    ['unsubscribe', { sids: [7, 8] }],
    ['subscribe', { channels: ['ticker', 'trade'], market_tickers: ['C-3', 'D-4'] }],
  ]);

  stream.setMarkets(['D-4', 'C-3']); // same set: nothing sent
  assert.equal(s.sent.length, 4);
});

test('a late reply for markets we already left is unsubscribed immediately', async () => {
  const { stream, sockets } = harness();
  stream.setMarkets(['A-1']);
  stream.start();
  await tick();
  const s = sockets[0];
  s.open();
  const oldId = s.sent[1].id;
  stream.setMarkets(['B-2']);
  s.receive({ id: oldId, type: 'subscribed', msg: { channel: 'ticker', sid: 3 } });
  assert.deepEqual(s.sent.at(-1).cmd, 'unsubscribe');
  assert.deepEqual(s.sent.at(-1).params, { sids: [3] });
});

test('parses ticker, trade and fill messages in both price encodings', () => {
  assert.deepEqual(
    parseTicker({ market_ticker: 'X', yes_bid_dollars: '0.4500', yes_ask_dollars: '0.4700', price_dollars: '0.4600', volume_fp: '1200.00', ts: 1700000000 }),
    { ticker: 'X', bid: 45, ask: 47, last: 46, volume: 1200, ts: 1700000000000 },
  );
  assert.deepEqual(
    parseTicker({ market_ticker: 'X', yes_bid: 45, yes_ask: 47, price: 46, volume: 1200, ts: 1700000000123 }),
    { ticker: 'X', bid: 45, ask: 47, last: 46, volume: 1200, ts: 1700000000123 },
  );
  const partial = parseTicker({ market_ticker: 'X', yes_bid_dollars: '0.0000', ts: 1 });
  assert.equal(partial.bid, null);
  assert.equal(partial.ask, undefined);

  assert.deepEqual(parseTrade({ market_ticker: 'X', yes_price_dollars: '0.5500', count_fp: '12.00', ts: 1700000000 }), { ticker: 'X', price: 55, count: 12, ts: 1700000000000 });
  assert.deepEqual(parseTrade({ market_ticker: 'X', yes_price: 55, count: 12, ts: 1700000000 }).price, 55);
  assert.deepEqual(parseFill({ order_id: 'o1', market_ticker: 'X', count_fp: '3.00' }), { orderId: 'o1', ticker: 'X', count: 3 });
});

test('emits normalized events to listeners', async () => {
  const { stream, sockets } = harness();
  const got = [];
  stream.on('ticker', (t) => got.push(['ticker', t.ticker, t.ask]));
  stream.on('trade', (t) => got.push(['trade', t.ticker, t.price]));
  stream.on('fill', (f) => got.push(['fill', f.orderId]));
  stream.start();
  await tick();
  const s = sockets[0];
  s.open();
  s.receive({ type: 'ticker', sid: 1, msg: { market_ticker: 'A', yes_ask_dollars: '0.6100' } });
  s.receive({ type: 'trade', sid: 2, msg: { market_ticker: 'A', yes_price_dollars: '0.6000', count_fp: '5.00' } });
  s.receive({ type: 'fill', sid: 3, msg: { order_id: 'o9' } });
  s.args.onMessage('not json');
  assert.deepEqual(got, [['ticker', 'A', 61], ['trade', 'A', 60], ['fill', 'o9']]);
  assert.ok(stream.lastMessageAt > 0);
});

test('reconnects with backoff and tries the next host when one never opens', async () => {
  const { stream, sockets, timers } = harness();
  stream.setMarkets(['A-1']);
  stream.start();
  await tick();
  sockets[0].drop(); // never opened
  assert.equal(stream.status, 'reconnecting');
  assert.equal(timers.at(-1).ms, 500);

  timers.at(-1).fn();
  await tick();
  assert.equal(sockets[1].args.url, 'wss://external-api.kalshi.com/trade-api/ws/v2');
  sockets[1].open();
  assert.equal(stream.status, 'live');
  assert.deepEqual(sockets[1].sent[1].params.market_tickers, ['A-1'], 'resubscribes after reconnecting');

  sockets[1].drop(); // was open: stay on this host, backoff starts over
  assert.equal(timers.at(-1).ms, 500);
  timers.at(-1).fn();
  await tick();
  assert.equal(sockets[2].args.url, 'wss://external-api.kalshi.com/trade-api/ws/v2');

  sockets[2].drop(); // retry never opened: back off further
  assert.equal(timers.at(-1).ms, 1000);
  timers.at(-1).fn();
  await tick();
  sockets[3].drop();
  assert.equal(timers.at(-1).ms, 2000, 'keeps backing off while it keeps failing');
});

test('ignores messages from a socket that has been replaced', async () => {
  const { stream, sockets, timers } = harness();
  const got = [];
  stream.on('ticker', (t) => got.push(t.ticker));
  stream.start();
  await tick();
  const old = sockets[0];
  old.open();
  old.drop();
  timers.at(-1).fn();
  await tick();
  old.receive({ type: 'ticker', msg: { market_ticker: 'STALE' } });
  sockets[1].open();
  sockets[1].receive({ type: 'ticker', msg: { market_ticker: 'FRESH' } });
  assert.deepEqual(got, ['FRESH']);
});

test('reports unsupported runtimes and stops cleanly', async () => {
  const none = harness({ unsupported: true });
  none.stream.start();
  await tick();
  assert.equal(none.stream.status, 'unsupported');

  const { stream, sockets, timers } = harness({ env: 'demo' });
  stream.start();
  await tick();
  assert.equal(sockets[0].args.url, 'wss://demo-api.kalshi.co/trade-api/ws/v2');
  sockets[0].open();
  stream.stop();
  assert.equal(sockets[0].closed, true);
  assert.equal(stream.status, 'idle');
  sockets[0].drop();
  assert.equal(timers.length, 0, 'no reconnect after stop');
});
