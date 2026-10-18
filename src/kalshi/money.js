// Kalshi quotes prices as fixed-point dollar strings ("0.5600") and counts as
// fixed-point strings ("10.00"). The app works in cents and whole contracts.

export const MIN_PRICE = 1;
export const MAX_PRICE = 99;

/** "0.5600" -> 56 (null when missing). Keeps sub-cent precision. */
export function toCents(dollars) {
  if (dollars == null || dollars === '') return null;
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 10000) / 100 : null;
}

/** 56 -> "0.5600" */
export function toDollarString(cents) {
  return (cents / 100).toFixed(4);
}

/** "10.00" -> 10 */
export function toCount(fp) {
  const n = Number(fp);
  return Number.isFinite(n) ? n : 0;
}

/** Tick size (cents) at a price, from a market's `price_ranges`. Defaults to 1¢. */
export function tickAt(cents, ranges) {
  for (const r of ranges || []) {
    const start = toCents(r.start);
    const end = toCents(r.end);
    const step = toCents(r.step);
    if (step > 0 && cents >= start && cents <= end) return step;
  }
  return 1;
}

/** Snap a price onto the market's tick grid. */
export function roundToTick(cents, ranges, direction = 'nearest') {
  const step = tickAt(cents, ranges);
  const units = cents / step;
  const snapped =
    direction === 'up' ? Math.ceil(units - 1e-9) : direction === 'down' ? Math.floor(units + 1e-9) : Math.round(units);
  return Math.round(snapped * step * 100) / 100;
}

export function clampPrice(cents) {
  return Math.min(MAX_PRICE, Math.max(MIN_PRICE, cents));
}

export function formatCents(cents) {
  if (cents == null) return '—';
  return Number.isInteger(cents) ? `${cents}¢` : `${cents.toFixed(1)}¢`;
}

export function formatUsd(cents, { signed = false } = {}) {
  const value = Math.round(cents) / 100;
  const text = Math.abs(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  if (value < 0) return `−${text}`;
  return signed && value > 0 ? `+${text}` : text;
}
