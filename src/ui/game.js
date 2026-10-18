import { formatCents, formatUsd } from '../kalshi/money.js';
import { dayLabel, parseGame } from '../nba.js';
import { clampSetting, saveSettings, stepStake } from '../store.js';
import { held, planEntry, realizedPnl, soldCount, targetFor } from '../trader.js';
import { stepper } from './controls.js';
import { h, haptic, poll, svgIcon, toast } from './dom.js';

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

  function tradeCard(trade) {
    const side = sideByTicker(trade.ticker);
    const bid = side?.bid ?? null;
    const left = held(trade);
    const entry = Math.round(trade.entryCents * 10) / 10;

    let chip, progress = 0, pnlText = '';
    if (trade.status === 'done') {
      chip = h('span', { class: 'chip chip-green' }, 'Sold ✓');
      progress = 1;
      const pnl = realizedPnl(trade);
      pnlText = `${formatUsd(pnl, { signed: true })} before fees`;
    } else {
      const unrealized = bid != null ? left * (bid - trade.entryCents) : 0;
      const pnl = realizedPnl(trade) + unrealized;
      pnlText = bid != null ? `${formatUsd(pnl, { signed: true })} if sold now` : '';
      if (trade.status === 'open') {
        chip = h('span', { class: 'chip chip-gold' }, 'Waiting');
        if (bid != null && trade.targetCents > trade.entryCents) {
          progress = Math.min(1, Math.max(0, (bid - trade.entryCents) / (trade.targetCents - trade.entryCents)));
        }
      } else {
        chip = h('span', { class: 'chip chip-red' }, 'Needs attention');
      }
    }

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

    const sold = soldCount(trade);
    return h('article', { class: 'trade', style: { '--team': trade.color } },
      h('div', { class: 'trade-head' },
        h('span', { class: 'trade-title' }, `${trade.code} · ${trade.count} contract${trade.count === 1 ? '' : 's'}`),
        chip,
      ),
      h('div', { class: 'trade-prices' },
        h('span', null, 'Bought ', h('b', null, formatCents(entry))),
        h('span', { class: 'arrow' }, '→'),
        h('span', null, 'Target ', h('b', null, formatCents(trade.targetCents))),
        h('span', { class: 'trade-now' }, trade.status === 'done' ? '' : `Now ${formatCents(bid)}`),
      ),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(progress * 100)) },
        h('span', { style: { width: `${progress * 100}%` } }),
      ),
      h('div', { class: 'trade-foot' },
        h('span', { class: `pnl ${pnlText.startsWith('+') ? 'pos' : pnlText.startsWith('−') ? 'neg' : ''}` },
          pnlText,
          sold > 0 && trade.status !== 'done' ? h('span', { class: 'muted' }, ` · ${sold} sold`) : null,
        ),
        h('span', { class: 'trade-actions' }, actions),
      ),
      trade.note ? h('p', { class: 'trade-note' }, trade.note) : null,
    );
  }

  function renderTrades() {
    const trades = ctx.store.forEvent(game.eventTicker);
    tradesEl.replaceChildren();
    if (!trades.length) {
      tradesEl.append(h('p', { class: 'hint muted' },
        "Big run? Hold your team's button. Cha-Ching buys at the current price and lists it for sale at your target right away. It sells on Kalshi even if your phone is locked."));
      return;
    }
    tradesEl.append(h('h2', { class: 'section-label' }, 'Your trades'), ...trades.map(tradeCard));
  }

  // --- Polling ---------------------------------------------------------------

  async function refreshPrices() {
    try {
      const updated = parseGame(await ctx.client.getEvent(game.eventTicker));
      staleEl.hidden = true;
      if (!updated) return;
      game = updated;
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
          h('h1', null, `${game.away.code} @ ${game.home.code}`),
          h('span', { class: 'muted small' }, `${dayLabel(game.date)}${ctx.env === 'demo' ? ' · Demo' : ''}`),
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

  updateButtons();
  renderTrades();
  // Fills on resting targets are picked up by the session-wide watcher in main.js.
  const unsubscribe = ctx.store.subscribe(renderTrades);
  ctx.refreshBalance = refreshBalance;
  const stops = [poll(refreshPrices, 2000), poll(refreshBalance, 30000)];
  return () => {
    stops.forEach((stop) => stop());
    unsubscribe();
    ctx.refreshBalance = null;
  };
}
