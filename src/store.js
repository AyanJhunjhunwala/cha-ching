// Local persistence. Everything stays on the device.

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// --- Credentials -----------------------------------------------------------
// Electron encrypts with the OS keychain via safeStorage; on iPhone the
// WebView's storage lives inside the app sandbox.

const CREDS_KEY = 'chaching.creds';

export async function saveCreds(creds) {
  if (window.chaching?.secureSet) return window.chaching.secureSet(JSON.stringify(creds));
  return writeJson(CREDS_KEY, creds);
}

export async function loadCreds() {
  if (window.chaching?.secureGet) {
    const raw = await window.chaching.secureGet();
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  return readJson(CREDS_KEY, null);
}

export async function clearCreds() {
  if (window.chaching?.secureClear) return window.chaching.secureClear();
  try {
    localStorage.removeItem(CREDS_KEY);
  } catch {
    /* storage unavailable */
  }
}

// --- Settings --------------------------------------------------------------

const SETTINGS_KEY = 'chaching.settings';

export const SETTING_LIMITS = {
  stakeDollars: { min: 1, max: 1000 },
  takeProfitCents: { min: 1, max: 50 },
  slippageCents: { min: 0, max: 10 },
};

const DEFAULT_SETTINGS = { stakeDollars: 5, takeProfitCents: 5, slippageCents: 2 };

export function clampSetting(name, value) {
  const { min, max } = SETTING_LIMITS[name];
  const n = Number.isFinite(value) ? value : DEFAULT_SETTINGS[name];
  return Math.min(max, Math.max(min, name === 'stakeDollars' ? Math.round(n * 100) / 100 : Math.round(n)));
}

export function loadSettings() {
  const saved = readJson(SETTINGS_KEY, {});
  const out = {};
  for (const name of Object.keys(DEFAULT_SETTINGS)) out[name] = clampSetting(name, Number(saved[name] ?? DEFAULT_SETTINGS[name]));
  return out;
}

export function saveSettings(settings) {
  writeJson(SETTINGS_KEY, settings);
}

/** Stake stepper: $1 steps to $10, $5 to $50, $10 to $200, then $50. */
export function stepStake(value, direction) {
  const steps = [[10, 1], [50, 5], [200, 10], [Infinity, 50]];
  if (direction > 0) {
    const [, step] = steps.find(([upTo]) => value < upTo);
    return clampSetting('stakeDollars', Math.floor(value / step) * step + step);
  }
  const [, step] = steps.find(([upTo]) => value <= upTo);
  return clampSetting('stakeDollars', Math.ceil(value / step) * step - step);
}

// --- Selected sport --------------------------------------------------------

const SPORT_KEY = 'chaching.sport';

export function loadSportKey() {
  return readJson(SPORT_KEY, null);
}

export function saveSportKey(key) {
  writeJson(SPORT_KEY, key);
}

// --- Trades ----------------------------------------------------------------

const MAX_TRADES = 100;

export class TradeStore {
  constructor(env, keyId) {
    this.key = `chaching.trades.${env}.${keyId}`;
    this.trades = readJson(this.key, []);
    this.listeners = new Set();
  }

  forEvent(eventTicker) {
    return this.trades.filter((t) => t.eventTicker === eventTicker);
  }

  openCount(eventTicker) {
    return this.trades.filter((t) => t.eventTicker === eventTicker && t.status !== 'done').length;
  }

  save(trade) {
    const i = this.trades.findIndex((t) => t.id === trade.id);
    if (i >= 0) this.trades[i] = trade;
    else this.trades.unshift(trade);
    if (this.trades.length > MAX_TRADES) {
      const doneIdx = this.trades.findLastIndex((t) => t.status === 'done');
      this.trades.splice(doneIdx >= 0 ? doneIdx : this.trades.length - 1, 1);
    }
    this.persist();
  }

  remove(id) {
    this.trades = this.trades.filter((t) => t.id !== id);
    this.persist();
  }

  persist() {
    writeJson(this.key, this.trades);
    for (const fn of this.listeners) fn();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
