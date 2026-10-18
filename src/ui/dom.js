// Tiny DOM helpers — no framework needed for three screens.

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v);
    } else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (typeof value !== 'string' && key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function svgIcon(name) {
  const paths = {
    back: '<path d="M15 5l-7 7 7 7" />',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"/>',
  };
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  return span;
}

export function logo(size = 40) {
  const span = document.createElement('span');
  span.className = 'logo';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="22" fill="#F7C948"/><circle cx="24" cy="24" r="17" fill="none" stroke="#C99A1E" stroke-width="2"/>
    <text x="24" y="32" text-anchor="middle" font-size="22" font-weight="800" fill="#5C4205" font-family="-apple-system, system-ui, sans-serif">¢</text></svg>`;
  return span;
}

/** Red pulsing "LIVE" pill for games in progress. */
export function liveBadge() {
  return h('span', { class: 'live-badge' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'LIVE');
}

let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.className = `toast toast-${kind} show`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 5000 : 3200);
}

/**
 * Runs `fn` every `ms` while the app is visible; returns a stop function.
 * `ms` may be a function, re-read before each wait (e.g. slower while streaming);
 * call `stop.now()` to run immediately and pick up a new interval.
 */
export function poll(fn, ms) {
  let timer;
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || running) return;
    clearTimeout(timer);
    running = true;
    try {
      if (!document.hidden) await fn();
    } catch {
      /* transient errors are surfaced by the caller */
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, typeof ms === 'function' ? ms() : ms);
    }
  };
  const onVisible = () => !document.hidden && tick();
  document.addEventListener('visibilitychange', onVisible);
  tick();
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
  stop.now = tick;
  return stop;
}

const native = Capacitor.isNativePlatform();
export const haptic = {
  press: () => native && Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}),
  fire: () => native && Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {}),
  success: () => native && Haptics.notification({ type: NotificationType.Success }).catch(() => {}),
  error: () => native && Haptics.notification({ type: NotificationType.Error }).catch(() => {}),
};
