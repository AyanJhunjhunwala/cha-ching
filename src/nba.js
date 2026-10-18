// Turns Kalshi KXNBAGAME events into "games": two teams, each backed by the
// market that pays out if that team wins.

import { toCents } from './kalshi/money.js';

export const TEAMS = {
  ATL: { city: 'Atlanta', name: 'Hawks', color: '#E03A3E', alt: '#26282A' },
  BOS: { city: 'Boston', name: 'Celtics', color: '#007A33', alt: '#8B6F3E' },
  BKN: { city: 'Brooklyn', name: 'Nets', color: '#1F1F1F', alt: '#5F6264' },
  CHA: { city: 'Charlotte', name: 'Hornets', color: '#00788C', alt: '#1D1160' },
  CHI: { city: 'Chicago', name: 'Bulls', color: '#CE1141', alt: '#1F1F1F' },
  CLE: { city: 'Cleveland', name: 'Cavaliers', color: '#860038', alt: '#041E42' },
  DAL: { city: 'Dallas', name: 'Mavericks', color: '#00538C', alt: '#002B5E' },
  DEN: { city: 'Denver', name: 'Nuggets', color: '#0E2240', alt: '#8B2131' },
  DET: { city: 'Detroit', name: 'Pistons', color: '#1D42BA', alt: '#C8102E' },
  GSW: { city: 'Golden State', name: 'Warriors', color: '#1D428A', alt: '#9A7B1C' },
  HOU: { city: 'Houston', name: 'Rockets', color: '#CE1141', alt: '#1F1F1F' },
  IND: { city: 'Indiana', name: 'Pacers', color: '#002D62', alt: '#A87A1C' },
  LAC: { city: 'LA', name: 'Clippers', color: '#C8102E', alt: '#1D428A' },
  LAL: { city: 'Los Angeles', name: 'Lakers', color: '#552583', alt: '#9A7B1C' },
  MEM: { city: 'Memphis', name: 'Grizzlies', color: '#5D76A9', alt: '#12173F' },
  MIA: { city: 'Miami', name: 'Heat', color: '#98002E', alt: '#1F1F1F' },
  MIL: { city: 'Milwaukee', name: 'Bucks', color: '#00471B', alt: '#0077C0' },
  MIN: { city: 'Minnesota', name: 'Timberwolves', color: '#236192', alt: '#0C2340' },
  NOP: { city: 'New Orleans', name: 'Pelicans', color: '#0C2340', alt: '#85714D' },
  NYK: { city: 'New York', name: 'Knicks', color: '#006BB6', alt: '#D9661F' },
  OKC: { city: 'Oklahoma City', name: 'Thunder', color: '#007AC1', alt: '#EF3B24' },
  ORL: { city: 'Orlando', name: 'Magic', color: '#0077C0', alt: '#1F1F1F' },
  PHI: { city: 'Philadelphia', name: '76ers', color: '#ED174C', alt: '#006BB6' },
  PHX: { city: 'Phoenix', name: 'Suns', color: '#E56020', alt: '#1D1160' },
  POR: { city: 'Portland', name: 'Trail Blazers', color: '#E03A3E', alt: '#1F1F1F' },
  SAC: { city: 'Sacramento', name: 'Kings', color: '#5A2D81', alt: '#63727A' },
  SAS: { city: 'San Antonio', name: 'Spurs', color: '#2B2F33', alt: '#6E7377' },
  TOR: { city: 'Toronto', name: 'Raptors', color: '#CE1141', alt: '#1F1F1F' },
  UTA: { city: 'Utah', name: 'Jazz', color: '#5B2B82', alt: '#002B5C' },
  WAS: { city: 'Washington', name: 'Wizards', color: '#002B5C', alt: '#E31837' },
};

// Alternate abbreviations seen across data providers.
const ALIASES = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', PHO: 'PHX', BRK: 'BKN', WSH: 'WAS', UTAH: 'UTA', CHO: 'CHA' };

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** "KXNBAGAME-25OCT21HOUOKC" -> { date: Oct 21 2025 (local), matchup: "HOUOKC" } */
export function parseEventTicker(eventTicker) {
  const m = /-(\d{2})([A-Z]{3})(\d{2})([A-Z0-9]*)$/.exec(eventTicker || '');
  if (!m || !(m[2] in MONTHS)) return { date: null, matchup: '' };
  return { date: new Date(2000 + Number(m[1]), MONTHS[m[2]], Number(m[3])), matchup: m[4] };
}

/** Best bid / ask on the YES side, in cents; null when that side of the book is empty. */
export function quote(market) {
  const bid = toCents(market.yes_bid_dollars);
  const ask = toCents(market.yes_ask_dollars);
  return {
    bid: bid != null && bid > 0 ? bid : null,
    ask: ask != null && ask < 100 && ask > 0 ? ask : null,
    last: toCents(market.last_price_dollars) || null,
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

const FALLBACK_COLORS = ['#2563EB', '#DC2626', '#059669', '#7C3AED', '#D97706', '#0891B2'];

function fallbackColor(code) {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

function toSide(market) {
  const raw = market.ticker.split('-').pop();
  const code = ALIASES[raw] ?? raw;
  const team = TEAMS[code];
  return {
    ticker: market.ticker,
    raw,
    code,
    city: team?.city ?? market.yes_sub_title ?? code,
    name: team?.name ?? market.yes_sub_title ?? code,
    color: team?.color ?? fallbackColor(code),
    alt: team?.alt ?? '#3a3f47',
    status: market.status,
    priceRanges: market.price_ranges ?? [],
    ...quote(market),
  };
}

/** @returns game object, or null if the event doesn't look like a two-team game. */
export function parseGame(event) {
  const markets = (event.markets ?? []).filter((m) => m.ticker);
  if (markets.length < 2) return null;

  const { date, matchup } = parseEventTicker(event.event_ticker);
  const sides = markets.slice(0, 2).map(toSide);
  // The event code lists the away team first ("HOUOKC" = Houston at OKC).
  const pos = (s) => {
    const i = matchup.indexOf(s.raw);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  if (pos(sides[1]) < pos(sides[0])) sides.reverse();
  const [away, home] = sides;
  // Keep the two buttons visually distinct when team colors clash.
  if (colorDistance(away.color, home.color) < 90) home.color = home.alt;

  return {
    eventTicker: event.event_ticker,
    title: event.title ?? `${away.city} at ${home.city}`,
    date,
    away,
    home,
    tradable: away.status === 'active' && home.status === 'active',
  };
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dayLabel(date, now = new Date()) {
  if (!date) return 'Upcoming';
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Sorts games by date and groups them under day headings. */
export function groupByDay(games, now = new Date()) {
  const sorted = [...games].sort(
    (a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity) || a.eventTicker.localeCompare(b.eventTicker),
  );
  const groups = [];
  for (const game of sorted) {
    const label = dayLabel(game.date, now);
    if (groups.at(-1)?.label !== label) groups.push({ label, games: [] });
    groups.at(-1).games.push(game);
  }
  return groups;
}

export function matchesSearch(game, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [game.away, game.home].some((s) => [s.code, s.city, s.name].some((v) => v.toLowerCase().includes(q)));
}
