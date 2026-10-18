import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayLabel, groupByDay, isLive, liveState, matchesSearch, parseEventTicker, parseGame, quote, sportForEvent, SPORTS, startsInLabel, timingByEvent } from '../src/sports.js';

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
  assert.deepEqual(parseEventTicker('garbage'), { date: null, hasTime: false, matchup: '' });
});

test('parseEventTicker reads MLB start times as Eastern time', () => {
  const summer = parseEventTicker('KXMLBGAME-26MAY292005KCTEX');
  assert.equal(summer.matchup, 'KCTEX');
  assert.equal(summer.hasTime, true);
  assert.equal(summer.date.toISOString(), '2026-05-30T00:05:00.000Z'); // 8:05 PM EDT
  assert.equal(parseEventTicker('KXMLBGAME-26MAR281305NYYBOS').date.toISOString(), '2026-03-28T17:05:00.000Z'); // 1:05 PM EDT
  assert.equal(parseEventTicker('KXMLBGAME-26MAR011305NYYBOS').date.toISOString(), '2026-03-01T18:05:00.000Z'); // 1:05 PM EST
  assert.equal(parseEventTicker('KXNFLGAME-26SEP14DENKC').hasTime, false);
});

test('each series maps to its sport and games are tagged with it', () => {
  assert.deepEqual(['KXNBAGAME-25OCT21HOUOKC', 'KXNFLGAME-26SEP14DENKC', 'KXMLBGAME-26MAY292005KCTEX', 'KXNHLGAME-X'].map((t) => sportForEvent(t)?.key ?? null), ['nba', 'nfl', 'mlb', null]);
  const game = parseGame({ event_ticker: 'KXNFLGAME-26SEP14DENKC', markets: [market('KXNFLGAME-26SEP14DENKC-KC', '0.6', '0.61'), market('KXNFLGAME-26SEP14DENKC-DEN', '0.38', '0.4')] });
  assert.equal(game.sport, 'nfl');
  assert.deepEqual([game.away.code, game.away.name, game.home.code, game.home.name], ['DEN', 'Broncos', 'KC', 'Chiefs']);
});

test('the same code means different teams in different sports', () => {
  const ev = (series, a, b) => ({ event_ticker: `${series}-26OCT18${a}${b}`, markets: [market(`${series}-26OCT18${a}${b}-${a}`, '0.5', '0.51'), market(`${series}-26OCT18${a}${b}-${b}`, '0.48', '0.5')] });
  assert.equal(parseGame(ev('KXNBAGAME', 'PHI', 'BOS')).away.name, '76ers');
  assert.equal(parseGame(ev('KXNFLGAME', 'PHI', 'DAL')).away.name, 'Eagles');
  assert.equal(parseGame(ev('KXMLBGAME', 'PHI', 'NYM')).away.name, 'Phillies');
});

test('two-letter and overlapping codes keep the right away team', () => {
  const nfl = parseGame({
    event_ticker: 'KXNFLGAME-26NOV01LACLA',
    markets: [market('KXNFLGAME-26NOV01LACLA-LA', '0.5', '0.51'), market('KXNFLGAME-26NOV01LACLA-LAC', '0.48', '0.5')],
  });
  assert.deepEqual([nfl.away.name, nfl.home.name], ['Chargers', 'Rams']);

  const mlb = parseGame({
    event_ticker: 'KXMLBGAME-26JUN011010LAALAD',
    markets: [market('KXMLBGAME-26JUN011010LAALAD-LAD', '0.6', '0.61'), market('KXMLBGAME-26JUN011010LAALAD-LAA', '0.39', '0.4')],
  });
  assert.deepEqual([mlb.away.name, mlb.home.name], ['Angels', 'Dodgers']);

  const jax = parseGame({
    event_ticker: 'KXNFLGAME-26OCT11JACTEN',
    markets: [market('KXNFLGAME-26OCT11JACTEN-TEN', '0.5', '0.51'), market('KXNFLGAME-26OCT11JACTEN-JAC', '0.48', '0.5')],
  });
  assert.deepEqual([jax.away.code, jax.away.name], ['JAX', 'Jaguars']);
});

test('tie and unrelated markets are ignored when picking the two teams', () => {
  const game = parseGame({
    event_ticker: 'KXNFLGAME-26SEP14DENKC',
    markets: [
      market('KXNFLGAME-26SEP14DENKC-TIE', '0.01', '0.02', { yes_sub_title: 'Tie' }),
      market('KXNFLGAME-26SEP14DENKC-XYZ', '0.01', '0.02'),
      market('KXNFLGAME-26SEP14DENKC-KC', '0.6', '0.61'),
      market('KXNFLGAME-26SEP14DENKC-DEN', '0.38', '0.4'),
    ],
  });
  assert.deepEqual([game.away.code, game.home.code], ['DEN', 'KC']);
});

test('doubleheaders sort by start time within the same day', () => {
  const g = (t) => parseGame({ event_ticker: t, markets: [market(`${t}-NYY`, '0.5', '0.51'), market(`${t}-BOS`, '0.48', '0.5')] });
  const late = g('KXMLBGAME-26JUL041905NYYBOS');
  const early = g('KXMLBGAME-26JUL041305NYYBOS');
  const groups = groupByDay([late, early], new Date('2026-07-04T12:00:00-04:00'));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].games.map((x) => x.eventTicker), [early.eventTicker, late.eventTicker]);
});

test('every team color keeps white text readable (3:1 or better)', () => {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const low = [];
  for (const sport of SPORTS) {
    for (const [code, team] of Object.entries(sport.teams)) {
      for (const color of [team.color, team.alt]) {
        const ratio = 1.05 / (luminance(color) + 0.05);
        if (ratio < 3) low.push(`${sport.key}:${code} ${color} ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(low, []);
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

test('timingByEvent reads game start times from milestones', () => {
  const timing = timingByEvent([
    { type: 'basketball_tournament', start_date: '2026-10-01T00:00:00Z', related_event_tickers: ['KXNBAGAME-26OCT20LALGSW'], primary_event_tickers: [] },
    { type: 'basketball_game', start_date: '2026-10-21T02:00:00Z', end_date: null, primary_event_tickers: ['KXNBAGAME-26OCT20LALGSW'], related_event_tickers: [] },
    { type: 'basketball_game', start_date: 'not a date', primary_event_tickers: ['KXNBAGAME-26OCT20BOSNYK'] },
    { type: 'football_game', start_date: '2026-10-18T17:00:00Z', end_date: '2026-10-18T20:30:00Z', related_event_tickers: ['KXNFLGAME-26OCT18DENKC'] },
  ]);
  assert.equal(timing.get('KXNBAGAME-26OCT20LALGSW').start.toISOString(), '2026-10-21T02:00:00.000Z');
  assert.equal(timing.has('KXNBAGAME-26OCT20BOSNYK'), false);
  assert.equal(timing.get('KXNFLGAME-26OCT18DENKC').end.toISOString(), '2026-10-18T20:30:00.000Z');
});

const nbaGame = (timing) => parseGame({
  event_ticker: 'KXNBAGAME-26OCT20LALGSW',
  markets: [market('KXNBAGAME-26OCT20LALGSW-LAL', '0.48', '0.5'), market('KXNBAGAME-26OCT20LALGSW-GSW', '0.5', '0.52')],
}, undefined, timing);

test('a milestone start time gives every sport a start time', () => {
  const game = nbaGame({ start: new Date('2026-10-21T02:00:00Z'), end: null });
  assert.equal(game.hasTime, true);
  assert.equal(game.start.toISOString(), '2026-10-21T02:00:00.000Z');
  assert.equal(game.date, game.start);
  assert.equal(nbaGame(null).start, null);
  assert.equal(parseGame({ event_ticker: 'KXMLBGAME-26MAY292005KCTEX', markets: [market('KXMLBGAME-26MAY292005KCTEX-KC', '0.4', '0.42'), market('KXMLBGAME-26MAY292005KCTEX-TEX', '0.57', '0.59')] }).start.toISOString(), '2026-05-30T00:05:00.000Z');
});

test('liveState follows the game window for each sport', () => {
  const start = new Date('2026-10-21T02:00:00Z');
  const game = nbaGame({ start, end: null });
  const at = (minutes) => new Date(start.getTime() + minutes * 60000);
  assert.equal(liveState(game, at(-30)), 'upcoming');
  assert.equal(startsInLabel(game, at(-25)), 'in 25m');
  assert.equal(startsInLabel(game, at(-90)), '');
  assert.equal(liveState(game, at(0)), 'live');
  assert.equal(liveState(game, at(179)), 'live'); // NBA window is 3h
  assert.equal(liveState(game, at(181)), 'ended');
  assert.equal(liveState(nbaGame(null), at(0)), 'unknown');

  const withEnd = nbaGame({ start, end: at(150) });
  assert.equal(liveState(withEnd, at(151)), 'ended');

  const mlb = parseGame({ event_ticker: 'KXMLBGAME-26MAY292005KCTEX', markets: [market('KXMLBGAME-26MAY292005KCTEX-KC', '0.4', '0.42'), market('KXMLBGAME-26MAY292005KCTEX-TEX', '0.57', '0.59')] });
  assert.equal(isLive(mlb, new Date(mlb.start.getTime() + 4.25 * 3600000)), true); // extra innings
});

test('live games come first under "Live now"', () => {
  const now = new Date('2026-10-21T03:00:00Z');
  const ev = (t, start) => parseGame({ event_ticker: t, markets: [market(`${t}-AAA`, '0.4', '0.5'), market(`${t}-BBB`, '0.5', '0.6')] }, undefined, start ? { start: new Date(start), end: null } : null);
  const groups = groupByDay([
    ev('KXNBAGAME-26OCT21AAABBB', '2026-10-21T23:00:00Z'),
    ev('KXNBAGAME-26OCT20CCCDDD', '2026-10-21T02:30:00Z'),
    ev('KXNBAGAME-26OCT20EEEFFF', '2026-10-21T01:00:00Z'),
    ev('KXNBAGAME-26OCT22GGGHHH', null),
  ], now);
  assert.equal(groups[0].label, 'Live now');
  assert.equal(groups[0].live, true);
  assert.deepEqual(groups[0].games.map((g) => g.eventTicker), ['KXNBAGAME-26OCT20EEEFFF', 'KXNBAGAME-26OCT20CCCDDD']);
  assert.ok(groups.slice(1).every((g) => !g.live && g.games.every((x) => !isLive(x, now))));
});
