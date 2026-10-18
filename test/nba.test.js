import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayLabel, groupByDay, matchesSearch, parseEventTicker, parseGame, quote } from '../src/nba.js';

const market = (ticker, bid, ask, extra = {}) => ({
  ticker,
  status: 'active',
  yes_bid_dollars: bid,
  yes_ask_dollars: ask,
  last_price_dollars: bid,
  price_ranges: [{ start: '0.0000', end: '1.0000', step: '0.0100' }],
  ...extra,
});

test('parseEventTicker reads the date and matchup', () => {
  const { date, matchup } = parseEventTicker('KXNBAGAME-25OCT21HOUOKC');
  assert.equal(matchup, 'HOUOKC');
  assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate()], [2025, 9, 21]);
  assert.deepEqual(parseEventTicker('garbage'), { date: null, matchup: '' });
});

test('quote converts dollar strings to cents and drops empty sides', () => {
  assert.deepEqual(quote(market('X', '0.4100', '0.4300')), { bid: 41, ask: 43, last: 41 });
  assert.deepEqual(quote(market('X', '0.0000', '1.0000')), { bid: null, ask: null, last: null });
  assert.equal(quote(market('X', '0.4150', '0.4250')).ask, 42.5);
});

test('parseGame puts the away team first regardless of market order', () => {
  const game = parseGame({
    event_ticker: 'KXNBAGAME-25OCT21HOUOKC',
    title: 'Houston at Oklahoma City',
    markets: [market('KXNBAGAME-25OCT21HOUOKC-OKC', '0.58', '0.59'), market('KXNBAGAME-25OCT21HOUOKC-HOU', '0.41', '0.42')],
  });
  assert.equal(game.away.code, 'HOU');
  assert.equal(game.away.name, 'Rockets');
  assert.equal(game.home.code, 'OKC');
  assert.equal(game.home.ask, 59);
  assert.equal(game.tradable, true);
});

test('parseGame keeps clashing team colors apart and maps aliases', () => {
  const game = parseGame({
    event_ticker: 'KXNBAGAME-26JAN05PHINY',
    markets: [market('KXNBAGAME-26JAN05PHINY-PHI', '0.5', '0.51'), market('KXNBAGAME-26JAN05PHINY-NY', '0.49', '0.5')],
  });
  assert.equal(game.home.code, 'NYK');
  assert.notEqual(game.away.color, game.home.color);

  const clash = parseGame({
    event_ticker: 'KXNBAGAME-26JAN05CHITOR',
    markets: [market('KXNBAGAME-26JAN05CHITOR-CHI', '0.5', '0.51'), market('KXNBAGAME-26JAN05CHITOR-TOR', '0.49', '0.5')],
  });
  assert.notEqual(clash.away.color, clash.home.color);
});

test('parseGame flags paused markets and rejects one-sided events', () => {
  const paused = parseGame({
    event_ticker: 'KXNBAGAME-25OCT21HOUOKC',
    markets: [market('A-HOU', '0.4', '0.42', { status: 'inactive' }), market('A-OKC', '0.58', '0.6')],
  });
  assert.equal(paused.tradable, false);
  assert.equal(parseGame({ event_ticker: 'X', markets: [market('A-HOU', '0.4', '0.42')] }), null);
});

test('groupByDay sorts games and labels days relative to now', () => {
  const now = new Date(2025, 9, 21, 19, 0);
  const g = (t) => parseGame({ event_ticker: t, markets: [market(`${t}-AAA`, '0.4', '0.5'), market(`${t}-BBB`, '0.5', '0.6')] });
  const groups = groupByDay([g('KXNBAGAME-25OCT23AAABBB'), g('KXNBAGAME-25OCT21AAABBB'), g('KXNBAGAME-25OCT22AAABBB')], now);
  assert.deepEqual(groups.map((x) => x.label), ['Today', 'Tomorrow', dayLabel(new Date(2025, 9, 23), now)]);
});

test('matchesSearch matches code, city or nickname', () => {
  const game = parseGame({
    event_ticker: 'KXNBAGAME-25OCT21HOUOKC',
    markets: [market('KXNBAGAME-25OCT21HOUOKC-HOU', '0.41', '0.42'), market('KXNBAGAME-25OCT21HOUOKC-OKC', '0.58', '0.59')],
  });
  for (const q of ['hou', 'Thunder', 'oklahoma', '']) assert.ok(matchesSearch(game, q), q);
  assert.ok(!matchesSearch(game, 'lakers'));
});
