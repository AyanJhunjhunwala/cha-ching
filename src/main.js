import './styles.css';

import { formatCents, formatUsd } from './kalshi/money.js';
import { connectSocket } from './kalshi/socket.js';
import { KalshiStream } from './kalshi/stream.js';
import { LiveTape } from './live.js';
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

/**
 * Keeps resting targets up to date and celebrates fills from any screen.
 * A `fill` pushed over the WebSocket triggers an immediate check; polling is
 * the safety net (every 3s without a stream, every 15s with one).
 */
function watchTrades(ctx) {
  async function check(trade) {
    try {
      await ctx.trader.refresh(trade);
    } catch {
      return;
    }
    if (trade.status === 'done') {
      haptic.success();
      toast(`Cha-ching! Sold ${trade.code} at ${formatCents(trade.targetCents)} · ${formatUsd(realizedPnl(trade), { signed: true })}`, 'success');
      ctx.refreshBalance?.();
    } else if (trade.status === 'unprotected') {
      toast(`${trade.code}: ${trade.note}`, 'error');
    }
  }

  const offFill = ctx.stream.on('fill', ({ orderId }) => {
    const trade = ctx.store.trades.find((t) => t.status === 'open' && t.sellOrderId === orderId);
    if (!trade) return;
    check(trade);
    // REST can trail the socket by a moment; look again shortly if it hasn't caught up.
    setTimeout(() => trade.status === 'open' && check(trade), 1500);
  });
  const stopPolling = poll(async () => {
    for (const trade of ctx.store.trades.filter((t) => t.status === 'open')) await check(trade);
  }, () => (ctx.stream.streaming ? 15000 : 3000));
  const offStatus = ctx.stream.on('status', (status) => status !== 'live' && stopPolling.now());

  return () => {
    offFill();
    offStatus();
    stopPolling();
  };
}

function startSession({ client, env, balanceCents }) {
  const store = new TradeStore(env, client.keyId);
  const stream = new KalshiStream({ keyId: client.keyId, signer: client.signer, env, connect: connectSocket });
  const wake = () => !document.hidden && stream.wake();
  // Registered before any screen's listeners, so screens always render the updated tape.
  const tape = new LiveTape();
  stream.on('ticker', (t) => tape.recordQuote(t.ticker, t));
  stream.on('trade', (t) => tape.recordTrade(t.ticker, t.count));
  const ctx = {
    client,
    env,
    balanceCents,
    store,
    stream,
    tape,
    settings: loadSettings(),
    trader: new Trader({ client, store }),
    gamesBySport: {}, // last loaded games per sport, so switching sports is instant
    refreshBalance: null, // set by whichever screen is showing a balance
    openMarkets: () => show(renderMarkets, ctx),
    openGame: (game) => show(renderGame, ctx, game),
    signOut: async () => {
      stopWatching();
      stream.stop();
      document.removeEventListener('visibilitychange', wake);
      await clearCreds();
      show(renderAuth, { onConnected: startSession });
    },
  };
  stream.start();
  document.addEventListener('visibilitychange', wake);
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
