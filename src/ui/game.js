import { formatCents, formatUsd } from '../kalshi/money.js';
import { dayLabel, isLive, parseGame, startsInLabel, startTimeLabel } from '../sports.js';
import { clampSetting, saveSettings, stepStake } from '../store.js';
import { held, planEntry, realizedPnl, soldCount, targetFor } from '../trader.js';
import { stepper } from './controls.js';
import { h, haptic, liveBadge, poll, svgIcon, toast } from './dom.js';

const HOLD_MS = 600;

const SHORT_REASON = {
  no_ask: 'No sellers right now',
  no_room: 'Target is past 99¢',
  stake_low: 'Raise your spend',
};

/**
 * One game: threshold controls on top, two big "favor" buttons, and the
 * trades you've made on this game underneath.
 */
export function renderGame(root, ctx, initialGame) {
  let game = initialGame;
  let buying = false;
  const armedUntil = new Map();
  const working = new Set();

  const balanceEl = h('span', { class: 'balance' }, formatUsd(ctx.balanceCents));
  const staleEl = h('div', { class: 'stale', hidden: true }, 'Reconnecting to Kalshi…');
  const badgeEl = h('span', { class: 'title-badge' });
  const subtitleEl = h('span', { class: 'muted small' });

  function updateHeader() {
    badgeEl.replaceChildren(...(isLive(game) ? [liveBadge()] : []));
    subtitleEl.textContent = [dayLabel(game.date), startsInLabel(game) || startTimeLabel(game), ctx.env === 'demo' ? 'Demo' : '']
      .filter(Boolean)
      .join(' · ');
  }
  const tradesEl = h('section', { class: 'trades', 'aria-live': 'polite' });

  const sideByTicker = (ticker) => [game.away, game.home].find((s) => s.ticker === ticker);

  async function refreshBalance() {
    try {
      ctx.balanceCents = await ctx.client.getBalanceCents();
      balanceEl.textContent = formatUsd(ctx.balanceCents);
    } catch {
      /* next poll will retry */
    }
  }

  // --- Favor buttons ---------------------------------------------------------

  function favorButton(key) {
    const fill = h('span', { class: 'favor-fill', 'aria-hidden': 'true' });
    const code = h('span', { class: 'favor-code' });
    const name = h('span', { class: 'favor-name' });
    const price = h('span', { class: 'favor-price' });
    const plan = h('span', { class: 'favor-plan' });
    const profit = h('span', { class: 'favor-profit' });
    const cta = h('span', { class: 'favor-cta' });
    const btn = h('button', { type: 'button', class: 'favor' },
      fill, code, name,
      h('span', { class: 'favor-price-wrap' }, price, h('span', { class: 'favor-price-label' }, 'buy price')),
      plan, profit, cta,
    );

    let timer = null;
    let lastAsk = null;
    const start = () => {
      if (buying || btn.getAttribute('aria-disabled') === 'true') return;
      btn.classList.add('holding');
      haptic.press();
      timer = setTimeout(fire, HOLD_MS);
    };
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      btn.classList.remove('holding');
    };
    const fire = async () => {
      timer = null;
      btn.classList.remove('holding');
      haptic.fire();
      await favor(key, btn);
    };

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      btn.setPointerCapture?.(e.pointerId);
      start();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, cancel);
    btn.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        start();
      }
    });
    btn.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && cancel());
    btn.addEventListener('contextmenu', (e) => e.preventDefault());

    function update() {
      const side = game[key];
      const { stakeDollars, takeProfitCents, slippageCents } = ctx.settings;
      btn.style.setProperty('--team', side.color);
      btn.setAttribute('aria-label', `Favor the ${side.city} ${side.name}. Press and hold to buy.`);
      code.textContent = side.code;
      name.textContent = side.name;
      price.textContent = formatCents(side.ask);

      if (lastAsk != null && side.ask != null && side.ask !== lastAsk) {
        price.classList.remove('tick-up', 'tick-down');
        void price.offsetWidth; // restart the flash animation
        price.classList.add(side.ask > lastAsk ? 'tick-up' : 'tick-down');
      }
      lastAsk = side.ask;

      let blocked = '';
      try {
        const p = planEntry({
          askCents: side.ask,
          stakeCents: Math.round(stakeDollars * 100),
          takeProfitCents,
          slippageCents,
          priceRanges: side.priceRanges,
        });
        const target = targetFor({ entryCents: side.ask, takeProfitCents, priceRanges: side.priceRanges });
        plan.textContent = `~${p.count} × ${formatCents(side.ask)} → sell ${formatCents(target)}`;
        profit.textContent = `+${formatUsd(p.count * takeProfitCents)} if it hits`;
      } catch (err) {
        blocked = SHORT_REASON[err.code] ?? err.message;
        plan.textContent = blocked;
        profit.textContent = '';
      }

      const disabled = buying || !game.tradable || Boolean(blocked);
      btn.setAttribute('aria-disabled', String(disabled));
      btn.classList.toggle('busy', buying && btn.dataset.firing === '1');
      cta.textContent = btn.dataset.firing === '1' ? 'Buying…' : !game.tradable ? 'Paused' : `Hold to favor`;
    }

    return { btn, update };
  }

  const buttons = [favorButton('away'), favorButton('home')];
  const updateButtons = () => buttons.forEach((b) => b.update());

  async function favor(key, btn) {
    buying = true;
    btn.dataset.firing = '1';
    updateButtons();
    try {
      const trade = await ctx.trader.favor({ eventTicker: game.eventTicker, side: game[key], settings: ctx.settings });
      const entry = formatCents(Math.round(trade.entryCents * 10) / 10);
      if (trade.status === 'unprotected') {
        haptic.error();
        toast(trade.note, 'error');
      } else {
        haptic.success();
        toast(trade.status === 'done'
          ? `Bought ${trade.count} ${trade.code} @ ${entry} and sold right away at ${formatCents(trade.targetCents)}`
          : `Bought ${trade.count} ${trade.code} @ ${entry} · selling at ${formatCents(trade.targetCents)}`, 'success');
      }
      refreshBalance();
    } catch (err) {
      haptic.error();
      toast(err.message, 'error');
    } finally {
      buying = false;
      delete btn.dataset.firing;
      updateButtons();
      renderTrades();
    }
  }

  // --- Trades ----------------------------------------------------------------

  async function runSellNow(trade) {
    working.add(trade.id);
    renderTrades();
    try {
      await ctx.trader.sellNow(trade, ctx.settings);
      if (trade.status === 'done') {
        haptic.success();
        toast(`Sold ${trade.code} · ${formatUsd(realizedPnl(trade), { signed: true })}`, 'success');
      } else {
        toast(trade.note, 'error');
      }
    } catch (err) {
      haptic.error();
      toast(err.message, 'error');
    } finally {
      working.delete(trade.id);
      renderTrades();
      refreshBalance();
    }
  }

  async function runRetarget(trade) {
    working.add(trade.id);
    renderTrades();
    try {
      await ctx.trader.placeTarget(trade);
      toast(trade.status === 'unprotected' ? trade.note : `Selling at ${formatCents(trade.targetCents)}`, trade.status === 'unprotected' ? 'error' : 'success');
    } finally {
      working.delete(trade.id);
      renderTrades();
    }
  }

  function sellNowButton(trade) {
    const armed = (armedUntil.get(trade.id) ?? 0) > Date.now();
    const busy = working.has(trade.id);
    return h('button', {
      type: 'button',
      class: `btn btn-small ${armed ? 'btn-danger' : 'btn-ghost'}`,
      disabled: busy,
      onclick: () => {
        if (!armed) {
          armedUntil.set(trade.id, Date.now() + 3000);
          renderTrades();
          setTimeout(renderTrades, 3050);
          return;
        }
        armedUntil.delete(trade.id);
        runSellNow(trade);
      },
    }, busy ? 'Working…' : armed ? 'Tap to confirm' : 'Sell now');
  }

  /**
   * Builds a trade card. The returned `update()` refreshes only the parts that
   * move with the market (current bid, progress, P&L) so pushed price ticks
   * never replace buttons out from under a tap.
   */
  function tradeCard(trade) {
    const entry = Math.round(trade.entryCents * 10) / 10;
    const chip = trade.status === 'done'
      ? h('span', { class: 'chip chip-green' }, 'Sold ✓')
      : trade.status === 'open'
        ? h('span', { class: 'chip chip-gold' }, 'Waiting')
        : h('span', { class: 'chip chip-red' }, 'Needs attention');

    const actions = [];
    if (trade.status === 'open') actions.push(sellNowButton(trade));
    if (trade.status === 'unprotected') {
      actions.push(
        h('button', { type: 'button', class: 'btn btn-small btn-primary', disabled: working.has(trade.id), onclick: () => runRetarget(trade) },
          `Sell at ${formatCents(trade.targetCents)}`),
        sellNowButton(trade),
      );
    }
    if (trade.status === 'done') {
      actions.push(h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => ctx.store.remove(trade.id) }, 'Clear'));
    }

    const nowEl = h('span', { class: 'trade-now' });
    const barEl = h('span');
    const progressEl = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, barEl);
    const pnlEl = h('span', { class: 'pnl' });
    const sold = soldCount(trade);

    const el = h('article', { class: 'trade', style: { '--team': trade.color } },
      h('div', { class: 'trade-head' },
        h('span', { class: 'trade-title' }, `${trade.code} · ${trade.count} contract${trade.count === 1 ? '' : 's'}`),
        chip,
      ),
      h('div', { class: 'trade-prices' },
        h('span', null, 'Bought ', h('b', null, formatCents(entry))),
        h('span', { class: 'arrow' }, '→'),
        h('span', null, 'Target ', h('b', null, formatCents(trade.targetCents))),
        nowEl,
      ),
      progressEl,
      h('div', { class: 'trade-foot' },
        h('span', null, pnlEl, sold > 0 && trade.status !== 'done' ? h('span', { class: 'muted' }, ` · ${sold} sold`) : null),
        h('span', { class: 'trade-actions' }, actions),
      ),
      trade.note ? h('p', { class: 'trade-note' }, trade.note) : null,
    );

    function update() {
      const bid = sideByTicker(trade.ticker)?.bid ?? null;
      let progress = 0;
      let pnlText = '';
      if (trade.status === 'done') {
        progress = 1;
        pnlText = `${formatUsd(realizedPnl(trade), { signed: true })} before fees`;
      } else {
        if (bid != null) pnlText = `${formatUsd(realizedPnl(trade) + held(trade) * (bid - trade.entryCents), { signed: true })} if sold now`;
        if (trade.status === 'open' && bid != null && trade.targetCents > trade.entryCents) {
          progress = Math.min(1, Math.max(0, (bid - trade.entryCents) / (trade.targetCents - trade.entryCents)));
        }
      }
      nowEl.textContent = trade.status === 'done' ? '' : `Now ${formatCents(bid)}`;
      barEl.style.width = `${progress * 100}%`;
      progressEl.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
      pnlEl.textContent = pnlText;
      pnlEl.className = `pnl ${pnlText.startsWith('+') ? 'pos' : pnlText.startsWith('−') ? 'neg' : ''}`;
    }

    return { el, update };
  }

  // A card is rebuilt only when something structural changes; otherwise update() runs.
  const cards = new Map();
  const tradesHeading = h('h2', { class: 'section-label' }, 'Your trades');
  const tradesHint = h('p', { class: 'hint muted' },
    "Big moment? Hold your team's button. Cha-Ching buys at the current price and lists it for sale at your target right away. It sells on Kalshi even if your phone is locked.");
  const cardKey = (t) =>
    [t.status, soldCount(t), t.note, t.targetCents, (armedUntil.get(t.id) ?? 0) > Date.now(), working.has(t.id)].join('|');

  function renderTrades() {
    const trades = ctx.store.forEvent(game.eventTicker);
    for (const id of cards.keys()) if (!trades.some((t) => t.id === id)) cards.delete(id);
    const wanted = trades.length ? [tradesHeading] : [tradesHint];
    for (const trade of trades) {
      const key = cardKey(trade);
      let card = cards.get(trade.id);
      if (!card || card.key !== key) {
        card = { key, ...tradeCard(trade) };
        cards.set(trade.id, card);
      }
      card.update();
      wanted.push(card.el);
    }
    const current = [...tradesEl.children];
    if (current.length !== wanted.length || wanted.some((el, i) => current[i] !== el)) tradesEl.replaceChildren(...wanted);
  }

  // --- Live updates ------------------------------------------------------------
  // Prices arrive over the WebSocket as they change. Bursts are coalesced into
  // one redraw per animation frame. REST is the fallback (every 1s) when the
  // socket is down, and a slow reconciliation (every 10s) while it is up, to
  // pick up things the ticker doesn't carry, like a trading pause.

  const streamed = new Set(); // tickers with at least one pushed quote
  let frame = 0;
  function scheduleRender() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      updateButtons();
      renderTrades();
    });
  }

  const offTicker = ctx.stream.on('ticker', (t) => {
    const side = sideByTicker(t.ticker);
    if (!side) return;
    for (const k of ['bid', 'ask', 'last']) if (t[k] !== undefined) side[k] = t[k];
    streamed.add(t.ticker);
    scheduleRender();
  });

  async function refreshPrices() {
    try {
      // Single-event reads don't include milestones, so keep the start time we already have.
      const timing = game.start ? { start: game.start, end: game.end } : null;
      const updated = parseGame(await ctx.client.getEvent(game.eventTicker), undefined, timing);
      staleEl.hidden = true;
      if (!updated) return;
      // REST can lag the socket; while streaming, keep the pushed prices.
      if (ctx.stream.streaming) {
        for (const key of ['away', 'home']) {
          if (!streamed.has(updated[key].ticker)) continue;
          for (const k of ['bid', 'ask', 'last']) updated[key][k] = game[key][k];
        }
      }
      game = updated;
      updateHeader();
      updateButtons();
      renderTrades();
    } catch {
      staleEl.hidden = false;
    }
  }

  // --- Layout ----------------------------------------------------------------

  root.append(
    h('main', { class: 'screen game' },
      h('header', { class: 'topbar' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back to games', onclick: ctx.openMarkets }, svgIcon('back')),
        h('div', { class: 'topbar-title stack' },
          h('div', { class: 'title-row' }, h('h1', null, `${game.away.code} @ ${game.home.code}`), badgeEl),
          subtitleEl,
        ),
        balanceEl,
      ),
      staleEl,
      h('section', { class: 'card controls', 'aria-label': 'Trade settings' },
        stepper({
          label: 'Spend per tap',
          prefix: '$',
          decimals: 2,
          get: () => ctx.settings.stakeDollars,
          step: stepStake,
          set: (v) => {
            ctx.settings.stakeDollars = clampSetting('stakeDollars', v);
            saveSettings(ctx.settings);
            updateButtons();
            return ctx.settings.stakeDollars;
          },
        }),
        stepper({
          label: 'Sell when up',
          hint: 'Auto-sell this far above what you paid',
          prefix: '+',
          suffix: '¢',
          get: () => ctx.settings.takeProfitCents,
          step: (v, dir) => v + dir,
          set: (v) => {
            ctx.settings.takeProfitCents = clampSetting('takeProfitCents', v);
            saveSettings(ctx.settings);
            updateButtons();
            return ctx.settings.takeProfitCents;
          },
        }),
      ),
      h('section', { class: 'favor-grid' }, buttons.map((b) => b.btn)),
      tradesEl,
    ),
  );

  updateHeader();
  updateButtons();
  renderTrades();
  // Fills on resting targets are picked up by the session-wide watcher in main.js.
  const unsubscribe = ctx.store.subscribe(renderTrades);
  ctx.refreshBalance = refreshBalance;
  ctx.stream.setMarkets([game.away.ticker, game.home.ticker]);
  const pricePoll = poll(refreshPrices, () => (ctx.stream.streaming ? 10000 : 1000));
  // Switch cadence the moment the socket drops or comes back, not after the current wait.
  const offStatus = ctx.stream.on('status', () => pricePoll.now());
  const stops = [pricePoll, poll(refreshBalance, 30000)];
  return () => {
    stops.forEach((stop) => stop());
    unsubscribe();
    offTicker();
    offStatus();
    cancelAnimationFrame(frame);
    ctx.refreshBalance = null;
  };
}
