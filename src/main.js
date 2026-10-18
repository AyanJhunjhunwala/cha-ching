import './styles.css';

import { formatCents, formatUsd } from './kalshi/money.js';
import { connect } from './session.js';
import { clearCreds, loadCreds, loadSettings, TradeStore } from './store.js';
import { realizedPnl, Trader } from './trader.js';
import { renderAuth } from './ui/auth.js';
import { h, haptic, logo, poll, toast } from './ui/dom.js';
import { renderGame } from './ui/game.js';
import { renderMarkets } from './ui/markets.js';

const root = document.getElementById('app');
let teardown = null;

function show(render, ...args) {
  teardown?.();
  root.replaceChildren();
  teardown = render(root, ...args) ?? null;
  window.scrollTo(0, 0);
}

function renderSplash(el) {
  el.append(h('main', { class: 'screen splash' }, logo(64), h('p', { class: 'muted' }, 'Connecting to Kalshi…')));
}

/** Polls every resting target in the background and celebrates fills from any screen. */
function watchTrades(ctx) {
  return poll(async () => {
    for (const trade of ctx.store.trades.filter((t) => t.status === 'open')) {
      try {
        await ctx.trader.refresh(trade);
      } catch {
        continue;
      }
      if (trade.status === 'done') {
        haptic.success();
        toast(`Cha-ching! Sold ${trade.code} at ${formatCents(trade.targetCents)} · ${formatUsd(realizedPnl(trade), { signed: true })}`, 'success');
        ctx.refreshBalance?.();
      } else if (trade.status === 'unprotected') {
        toast(`${trade.code}: ${trade.note}`, 'error');
      }
    }
  }, 3000);
}

function startSession({ client, env, balanceCents }) {
  const store = new TradeStore(env, client.keyId);
  const ctx = {
    client,
    env,
    balanceCents,
    store,
    settings: loadSettings(),
    trader: new Trader({ client, store }),
    cachedGames: null,
    refreshBalance: null, // set by whichever screen is showing a balance
    openMarkets: () => show(renderMarkets, ctx),
    openGame: (game) => show(renderGame, ctx, game),
    signOut: async () => {
      stopWatching();
      await clearCreds();
      show(renderAuth, { onConnected: startSession });
    },
  };
  const stopWatching = watchTrades(ctx);
  ctx.openMarkets();
}

async function boot() {
  const saved = await loadCreds();
  if (!saved) return show(renderAuth, { onConnected: startSession });

  show(renderSplash);
  try {
    startSession(await connect(saved));
  } catch (err) {
    show(renderAuth, { onConnected: startSession, initial: saved, error: err.message });
  }
}

boot();
