import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatAge, formatMove, LiveTape } from '../src/live.js';

const T0 = 1_700_000_000_000;
const min = (m) => T0 + m * 60_000;

test('records only price changes and merges partial quotes', () => {
  const tape = new LiveTape();
  tape.recordQuote('A', { bid: 40, ask: 42 }, min(0));
  tape.recordQuote('A', { bid: 41 }, min(1)); // ask unchanged: no new point
  tape.recordQuote('A', { ask: 44 }, min(2));
  assert.deepEqual(tape.points.get('A').map((p) => p.price), [42, 44]);
  assert.deepEqual(tape.quotes.get('A'), { bid: 41, ask: 44 });
  tape.recordQuote('B', { last: 30 }, min(0)); // no ask: falls back to last trade
  assert.equal(tape.points.get('B')[0].price, 30);
});

test('change() needs a minute of history and measures over the span', () => {
  const tape = new LiveTape();
  tape.recordQuote('A', { ask: 50 }, min(0));
  assert.equal(tape.change('A', 5 * 60_000, min(0.5)), null, 'too little history');
  tape.recordQuote('A', { ask: 53 }, min(3));
  tape.recordQuote('A', { ask: 56 }, min(7));
  assert.deepEqual(tape.change('A', 5 * 60_000, min(8)), { delta: 3, minutes: 5 }, 'since 53 at minute 3');
  assert.equal(tape.change('missing'), null);

  const young = new LiveTape();
  young.recordQuote('A', { ask: 50 }, min(0));
  young.recordQuote('A', { ask: 53 }, min(3));
  assert.deepEqual(young.change('A', 5 * 60_000, min(4)), { delta: 3, minutes: 4 }, 'short history uses the first point');
});

test('series() is a step line over the window ending now', () => {
  const tape = new LiveTape({ windowMs: 10 * 60_000 });
  tape.recordQuote('A', { ask: 49 }, min(-5));
  tape.recordQuote('A', { ask: 50 }, min(0));
  tape.recordQuote('A', { ask: 52 }, min(8));
  tape.recordQuote('A', { ask: 51 }, min(12));
  const s = tape.series('A', min(15));
  assert.deepEqual(s.map((p) => p.price), [50, 52, 51, 51], 'starts from the price in effect at the window start');
  assert.equal(s[0].t, min(5), 'baseline clipped to the window start');
  assert.equal(s.at(-1).t, min(15));
  assert.deepEqual(tape.series('none'), []);
});

test('trades per minute and last move', () => {
  const tape = new LiveTape();
  for (let i = 0; i < 5; i++) tape.recordTrade('A', 10, min(0) + i * 1000);
  tape.recordTrade('B', 3, min(0) + 30_000);
  assert.equal(tape.tradesPerMinute(['A', 'B'], min(0.75)), 6);
  assert.equal(tape.tradesPerMinute(['A', 'B'], min(1.7)), 0);
  tape.recordQuote('A', { ask: 50 }, min(1));
  tape.recordQuote('B', { ask: 40 }, min(2));
  assert.equal(tape.lastMove(['A', 'B']), min(2));
  assert.equal(tape.lastMove(['C']), null);
});

test('formatting helpers', () => {
  assert.equal(formatAge(400), 'just now');
  assert.equal(formatAge(12_000), '12s ago');
  assert.equal(formatAge(150_000), '3m ago');
  assert.deepEqual(formatMove({ delta: 4, minutes: 5 }), { text: '▲ 4¢ · 5m', dir: 'up' });
  assert.deepEqual(formatMove({ delta: -1.5, minutes: 2 }), { text: '▼ 1.5¢ · 2m', dir: 'down' });
  assert.deepEqual(formatMove({ delta: 0, minutes: 5 }), { text: 'flat · 5m', dir: 'flat' });
  assert.equal(formatMove(null), null);
});
