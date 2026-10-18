// Turns Kalshi game events into "games": two teams, each backed by the market
// that pays out if that team wins. Each sport is one Kalshi series of
// single-game winner markets.

import { toCents } from './kalshi/money.js';

const NBA_TEAMS = {
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
const NBA_ALIASES = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', PHO: 'PHX', BRK: 'BKN', WSH: 'WAS', UTAH: 'UTA', CHO: 'CHA' };

const NFL_TEAMS = {
  ARI: { city: 'Arizona', name: 'Cardinals', color: '#97233F', alt: '#1F1F1F' },
  ATL: { city: 'Atlanta', name: 'Falcons', color: '#A71930', alt: '#1F1F1F' },
  BAL: { city: 'Baltimore', name: 'Ravens', color: '#241773', alt: '#9E7C0C' },
  BUF: { city: 'Buffalo', name: 'Bills', color: '#00338D', alt: '#C60C30' },
  CAR: { city: 'Carolina', name: 'Panthers', color: '#0085CA', alt: '#101820' },
  CHI: { city: 'Chicago', name: 'Bears', color: '#0B162A', alt: '#C83803' },
  CIN: { city: 'Cincinnati', name: 'Bengals', color: '#E04E14', alt: '#1F1F1F' },
  CLE: { city: 'Cleveland', name: 'Browns', color: '#311D00', alt: '#D93A00' },
  DAL: { city: 'Dallas', name: 'Cowboys', color: '#003594', alt: '#041E42' },
  DEN: { city: 'Denver', name: 'Broncos', color: '#E04E14', alt: '#002244' },
  DET: { city: 'Detroit', name: 'Lions', color: '#0076B6', alt: '#1F1F1F' },
  GB: { city: 'Green Bay', name: 'Packers', color: '#203731', alt: '#A87B00' },
  HOU: { city: 'Houston', name: 'Texans', color: '#03202F', alt: '#A71930' },
  IND: { city: 'Indianapolis', name: 'Colts', color: '#002C5F', alt: '#5F6264' },
  JAX: { city: 'Jacksonville', name: 'Jaguars', color: '#006778', alt: '#101820' },
  KC: { city: 'Kansas City', name: 'Chiefs', color: '#E31837', alt: '#A87B00' },
  LV: { city: 'Las Vegas', name: 'Raiders', color: '#1F1F1F', alt: '#5F6264' },
  LAC: { city: 'LA', name: 'Chargers', color: '#0073B2', alt: '#A87B00' },
  LAR: { city: 'Los Angeles', name: 'Rams', color: '#003594', alt: '#B36B00' },
  MIA: { city: 'Miami', name: 'Dolphins', color: '#008089', alt: '#D04000' },
  MIN: { city: 'Minnesota', name: 'Vikings', color: '#4F2683', alt: '#A87B00' },
  NE: { city: 'New England', name: 'Patriots', color: '#002244', alt: '#C60C30' },
  NO: { city: 'New Orleans', name: 'Saints', color: '#1F1F1F', alt: '#8A7444' },
  NYG: { city: 'New York', name: 'Giants', color: '#0B2265', alt: '#A71930' },
  NYJ: { city: 'New York', name: 'Jets', color: '#125740', alt: '#1F1F1F' },
  PHI: { city: 'Philadelphia', name: 'Eagles', color: '#004C54', alt: '#5F6264' },
  PIT: { city: 'Pittsburgh', name: 'Steelers', color: '#1F1F1F', alt: '#A87B00' },
  SF: { city: 'San Francisco', name: '49ers', color: '#AA0000', alt: '#8A7444' },
  SEA: { city: 'Seattle', name: 'Seahawks', color: '#002244', alt: '#3F7F1C' },
  TB: { city: 'Tampa Bay', name: 'Buccaneers', color: '#D50A0A', alt: '#34302B' },
  TEN: { city: 'Tennessee', name: 'Titans', color: '#0C2340', alt: '#3B78B8' },
  WAS: { city: 'Washington', name: 'Commanders', color: '#5A1414', alt: '#A87B00' },
};

const NFL_ALIASES = { JAC: 'JAX', LVR: 'LV', OAK: 'LV', LA: 'LAR', WSH: 'WAS', GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB' };

const MLB_TEAMS = {
  ARI: { city: 'Arizona', name: 'Diamondbacks', color: '#A71930', alt: '#1F1F1F' },
  ATL: { city: 'Atlanta', name: 'Braves', color: '#CE1141', alt: '#13274F' },
  BAL: { city: 'Baltimore', name: 'Orioles', color: '#D14200', alt: '#1F1F1F' },
  BOS: { city: 'Boston', name: 'Red Sox', color: '#BD3039', alt: '#0C2340' },
  CHC: { city: 'Chicago', name: 'Cubs', color: '#0E3386', alt: '#CC3433' },
  CWS: { city: 'Chicago', name: 'White Sox', color: '#27251F', alt: '#5F6264' },
  CIN: { city: 'Cincinnati', name: 'Reds', color: '#C6011F', alt: '#1F1F1F' },
  CLE: { city: 'Cleveland', name: 'Guardians', color: '#00385D', alt: '#E50022' },
  COL: { city: 'Colorado', name: 'Rockies', color: '#333366', alt: '#131413' },
  DET: { city: 'Detroit', name: 'Tigers', color: '#0C2340', alt: '#D9420F' },
  HOU: { city: 'Houston', name: 'Astros', color: '#002D62', alt: '#D35F12' },
  KC: { city: 'Kansas City', name: 'Royals', color: '#004687', alt: '#8C7240' },
  LAA: { city: 'LA', name: 'Angels', color: '#BA0021', alt: '#003263' },
  LAD: { city: 'Los Angeles', name: 'Dodgers', color: '#005A9C', alt: '#EF3E42' },
  MIA: { city: 'Miami', name: 'Marlins', color: '#0077A8', alt: '#1F1F1F' },
  MIL: { city: 'Milwaukee', name: 'Brewers', color: '#12284B', alt: '#A87B00' },
  MIN: { city: 'Minnesota', name: 'Twins', color: '#002B5C', alt: '#D31145' },
  NYM: { city: 'New York', name: 'Mets', color: '#002D72', alt: '#D9480F' },
  NYY: { city: 'New York', name: 'Yankees', color: '#0C2340', alt: '#5F6264' },
  ATH: { city: 'Athletics', name: "A's", color: '#003831', alt: '#A87B00' },
  PHI: { city: 'Philadelphia', name: 'Phillies', color: '#E81828', alt: '#002D72' },
  PIT: { city: 'Pittsburgh', name: 'Pirates', color: '#27251F', alt: '#A87B00' },
  SD: { city: 'San Diego', name: 'Padres', color: '#2F241D', alt: '#A87B00' },
  SF: { city: 'San Francisco', name: 'Giants', color: '#D94A16', alt: '#27251F' },
  SEA: { city: 'Seattle', name: 'Mariners', color: '#0C2C56', alt: '#005C5C' },
  STL: { city: 'St. Louis', name: 'Cardinals', color: '#C41E3A', alt: '#0C2340' },
  TB: { city: 'Tampa Bay', name: 'Rays', color: '#092C5C', alt: '#3D6E99' },
  TEX: { city: 'Texas', name: 'Rangers', color: '#003278', alt: '#C0111F' },
  TOR: { city: 'Toronto', name: 'Blue Jays', color: '#134A8E', alt: '#1D2D5C' },
  WSH: { city: 'Washington', name: 'Nationals', color: '#AB0003', alt: '#14225A' },
};

const MLB_ALIASES = { AZ: 'ARI', CHW: 'CWS', OAK: 'ATH', WAS: 'WSH', KCR: 'KC', SDP: 'SD', SFG: 'SF', TBR: 'TB', TBD: 'TB' };

// `liveHours` is how long after the scheduled start a game is treated as in
// progress when Kalshi doesn't give an end time (covers overtime/extra innings).
export const SPORTS = [
  { key: 'nba', label: 'NBA', icon: '🏀', series: 'KXNBAGAME', liveHours: 3, teams: NBA_TEAMS, aliases: NBA_ALIASES },
  { key: 'nfl', label: 'NFL', icon: '🏈', series: 'KXNFLGAME', liveHours: 4, teams: NFL_TEAMS, aliases: NFL_ALIASES },
  { key: 'mlb', label: 'MLB', icon: '⚾', series: 'KXMLBGAME', liveHours: 4.5, teams: MLB_TEAMS, aliases: MLB_ALIASES },
];

export const sportByKey = (key) => SPORTS.find((s) => s.key === key) ?? SPORTS[0];

/** The sport whose series an event belongs to, e.g. "KXNBAGAME-…" -> NBA. */
export const sportForEvent = (eventTicker) => SPORTS.find((s) => eventTicker?.startsWith(`${s.series}-`)) ?? null;

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** The instant a New York wall-clock time refers to (Kalshi lists start times in ET). */
function easternTime(year, month, day, hour, minute) {
  const wall = Date.UTC(year, month, day, hour, minute);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  for (const offsetHours of [4, 5]) {
    const instant = new Date(wall + offsetHours * 3600000);
    const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, Number(p.value)]));
    if (parts.hour === hour && parts.minute === minute) return instant;
  }
  return new Date(wall + 4 * 3600000);
}

/**
 * "KXNBAGAME-25OCT21HOUOKC"     -> { date: Oct 21 2025 (local midnight), hasTime: false, matchup: "HOUOKC" }
 * "KXMLBGAME-26MAY292005KCTEX"  -> { date: May 29 2026 8:05 PM ET,       hasTime: true,  matchup: "KCTEX" }
 */
export function parseEventTicker(eventTicker) {
  const m = /-(\d{2})([A-Z]{3})(\d{2})(\d{4})?([A-Z][A-Z0-9]*)$/.exec(eventTicker || '');
  if (!m || !(m[2] in MONTHS)) return { date: null, hasTime: false, matchup: '' };
  const [year, month, day] = [2000 + Number(m[1]), MONTHS[m[2]], Number(m[3])];
  if (!m[4]) return { date: new Date(year, month, day), hasTime: false, matchup: m[5] };
  const hhmm = Number(m[4]);
  return { date: easternTime(year, month, day, Math.floor(hhmm / 100), hhmm % 100), hasTime: true, matchup: m[5] };
}

const GAME_MILESTONE = /_(game|match)$/;

/**
 * Start/end times per event from Kalshi milestones (GET /events?with_milestones=true).
 * Prefers game-type milestones and events the milestone is primarily about.
 * @returns {Map<string, {start: Date, end: Date|null}>}
 */
export function timingByEvent(milestones = []) {
  const out = new Map();
  const ranked = [...milestones].sort((a, b) => Number(GAME_MILESTONE.test(b.type ?? '')) - Number(GAME_MILESTONE.test(a.type ?? '')));
  for (const pass of ['primary_event_tickers', 'related_event_tickers']) {
    for (const m of ranked) {
      const start = m.start_date ? new Date(m.start_date) : null;
      if (!start || Number.isNaN(start.getTime())) continue;
      const end = m.end_date ? new Date(m.end_date) : null;
      for (const ticker of m[pass] ?? []) {
        if (!out.has(ticker)) out.set(ticker, { start, end: end && !Number.isNaN(end.getTime()) ? end : null });
      }
    }
  }
  return out;
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

function toSide(market, sport) {
  const raw = market.ticker.split('-').pop();
  const code = sport?.aliases[raw] ?? raw;
  const team = sport?.teams[code];
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

const isTieMarket = (m) => /^(TIE|DRAW)$/.test(m.ticker.split('-').pop()) || /^(tie|draw)$/i.test(m.yes_sub_title ?? '');

/** The event code lists the away team first: "HOUOKC" = Houston at OKC, "KCTEX" = Kansas City at Texas. */
function awayFirst(sides, matchup) {
  const [a, b] = sides;
  if (matchup.startsWith(a.raw + b.raw)) return [a, b];
  if (matchup.startsWith(b.raw + a.raw)) return [b, a];
  const pos = (s) => {
    const i = matchup.indexOf(s.raw);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return pos(b) < pos(a) ? [b, a] : [a, b];
}

/**
 * @param timing optional {start, end} from timingByEvent(); otherwise the start
 *   time comes from the ticker when it has one (MLB).
 * @returns game object, or null if the event doesn't look like a two-team game.
 */
export function parseGame(event, sport = sportForEvent(event.event_ticker), timing = null) {
  const parsed = parseEventTicker(event.event_ticker);
  const start = timing?.start ?? (parsed.hasTime ? parsed.date : null);
  const { matchup } = parsed;
  const sides = (event.markets ?? [])
    .filter((m) => m.ticker && !isTieMarket(m))
    .map((m) => toSide(m, sport))
    // If an event ever carries extra markets, keep the two named in the event code.
    .sort((a, b) => Number(!matchup.includes(a.raw)) - Number(!matchup.includes(b.raw)))
    .slice(0, 2);
  if (sides.length < 2) return null;

  const [away, home] = awayFirst(sides, matchup);
  // Keep the two buttons visually distinct when team colors clash.
  if (colorDistance(away.color, home.color) < 90) home.color = home.alt;

  return {
    sport: sport?.key ?? null,
    eventTicker: event.event_ticker,
    title: event.title ?? `${away.city} at ${home.city}`,
    date: start ?? parsed.date,
    hasTime: Boolean(start),
    start,
    end: timing?.end ?? null,
    liveHours: sport?.liveHours ?? 3,
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

/** Local start time ("7:05 PM") when the event ticker carries one, else "". */
export function startTimeLabel(game) {
  return game.hasTime ? game.date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
}

/**
 * Where a game is in its life, from its start time:
 *   live     — started and still inside the game window
 *   upcoming — starts later
 *   ended    — past the window (Kalshi may not have settled yet)
 *   unknown  — no start time available
 */
export function liveState(game, now = new Date()) {
  if (!game.start) return 'unknown';
  const t = now.getTime();
  if (t < game.start.getTime()) return 'upcoming';
  const end = game.end?.getTime() ?? game.start.getTime() + game.liveHours * 3600000;
  return t < end ? 'live' : 'ended';
}

export const isLive = (game, now = new Date()) => liveState(game, now) === 'live';

/** "in 25m" for games starting within the hour, else "". */
export function startsInLabel(game, now = new Date()) {
  if (liveState(game, now) !== 'upcoming') return '';
  const minutes = Math.ceil((game.start.getTime() - now.getTime()) / 60000);
  return minutes <= 60 ? `in ${minutes}m` : '';
}

const byStart = (a, b) =>
  (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity) || a.eventTicker.localeCompare(b.eventTicker);

/** Live games first under "Live now", then the rest by start time under day headings. */
export function groupByDay(games, now = new Date()) {
  const live = games.filter((g) => isLive(g, now)).sort(byStart);
  const groups = live.length ? [{ label: 'Live now', live: true, games: live }] : [];
  for (const game of games.filter((g) => !isLive(g, now)).sort(byStart)) {
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
