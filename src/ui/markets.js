import { formatCents, formatUsd } from '../kalshi/money.js';
import { groupByDay, matchesSearch, parseGame } from '../nba.js';
import { clampSetting, saveSettings } from '../store.js';
import { sheet, stepper } from './controls.js';
import { h, logo, poll, svgIcon, toast } from './dom.js';

/** Scrollable list of open NBA games; tap one to trade it. */
export function renderMarkets(root, ctx) {
  let games = ctx.cachedGames ?? [];
  let loaded = games.length > 0;
  let loadError = '';
  let query = '';
  let closeSheet = null;

  const balanceEl = h('span', { class: 'balance', title: 'Cash balance' }, formatUsd(ctx.balanceCents));
  const listEl = h('div', { class: 'game-list' });
  const search = h('input', {
    class: 'input search-input',
    type: 'search',
    placeholder: 'Search teams',
    'aria-label': 'Search teams',
    oninput: () => {
      query = search.value;
      renderList();
    },
  });

  function teamRow(side) {
    return h('div', { class: 'team-row' },
      h('span', { class: 'team-dot', style: { background: side.color } }),
      h('span', { class: 'team-code' }, side.code),
      h('span', { class: 'team-name' }, side.name),
      h('span', { class: 'team-price' }, formatCents(side.ask ?? side.last)),
    );
  }

  function gameCard(game) {
    const open = ctx.store.openCount(game.eventTicker);
    return h('button', { type: 'button', class: 'game-card', onclick: () => ctx.openGame(game) },
      h('div', { class: 'game-teams' }, teamRow(game.away), teamRow(game.home)),
      h('div', { class: 'game-meta' },
        open ? h('span', { class: 'chip chip-gold' }, `${open} open`) : null,
        game.tradable ? null : h('span', { class: 'chip' }, 'Paused'),
        h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
      ),
    );
  }

  /** Trades on games that are no longer listed (finished or closed) stay reachable here. */
  function earlierTrades() {
    const listed = new Set(games.map((g) => g.eventTicker));
    const byEvent = new Map();
    for (const t of ctx.store.trades) {
      if (t.status === 'done' || listed.has(t.eventTicker)) continue;
      byEvent.set(t.eventTicker, [...(byEvent.get(t.eventTicker) ?? []), t]);
    }
    if (!byEvent.size) return [];
    return [
      h('h2', { class: 'day-label' }, 'Earlier games'),
      ...[...byEvent].map(([eventTicker, trades]) =>
        h('button', { type: 'button', class: 'game-card', onclick: () => openEvent(eventTicker) },
          h('div', { class: 'game-teams' },
            ...trades.map((t) => h('div', { class: 'team-row' },
              h('span', { class: 'team-dot', style: { background: t.color } }),
              h('span', { class: 'team-code' }, t.code),
              h('span', { class: 'team-name' }, `${t.count} contracts · ${t.status === 'open' ? 'waiting to sell' : 'needs attention'}`),
            )),
          ),
          h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
        )),
    ];
  }

  async function openEvent(eventTicker) {
    try {
      const game = parseGame(await ctx.client.getEvent(eventTicker));
      if (game) ctx.openGame(game);
      else toast('That game is no longer available on Kalshi.', 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function emptyState(title, body, action) {
    return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), h('p', { class: 'muted' }, body), action);
  }

  function renderList() {
    listEl.replaceChildren();
    if (!loaded) {
      listEl.append(...Array.from({ length: 4 }, () => h('div', { class: 'game-card skeleton' })));
      return;
    }
    if (loadError && !games.length) {
      listEl.append(emptyState("Couldn't load games", loadError, h('button', { type: 'button', class: 'btn btn-ghost', onclick: load }, 'Try again')));
      return;
    }
    if (!query) listEl.append(...earlierTrades());
    const visible = games.filter((g) => matchesSearch(g, query));
    if (!visible.length) {
      listEl.append(query
        ? emptyState('No matches', `No open games for "${query}".`)
        : emptyState('No games open', 'Kalshi has no NBA games open for trading right now. Check back closer to tip-off.'));
      return;
    }
    for (const group of groupByDay(visible)) {
      listEl.append(h('h2', { class: 'day-label' }, group.label), ...group.games.map(gameCard));
    }
  }

  async function load() {
    try {
      const events = await ctx.client.listEvents();
      games = events.map(parseGame).filter(Boolean);
      ctx.cachedGames = games;
      loadError = '';
    } catch (err) {
      loadError = err.message;
      if (loaded) toast(err.message, 'error');
    }
    loaded = true;
    renderList();
  }

  async function loadBalance() {
    try {
      ctx.balanceCents = await ctx.client.getBalanceCents();
      balanceEl.textContent = formatUsd(ctx.balanceCents);
    } catch {
      /* next poll will retry */
    }
  }

  function openSettings() {
    closeSheet = sheet('Settings',
      stepper({
        label: 'Max slippage',
        hint: 'How far above the current price a tap may pay so the order fills fast.',
        suffix: '¢',
        get: () => ctx.settings.slippageCents,
        step: (v, dir) => v + dir,
        set: (v) => {
          ctx.settings.slippageCents = clampSetting('slippageCents', v);
          saveSettings(ctx.settings);
          return ctx.settings.slippageCents;
        },
      }),
      h('div', { class: 'sheet-row' },
        h('span', { class: 'muted' }, 'Account'),
        h('span', null, `${ctx.env === 'demo' ? 'Demo' : 'Live'} · key ${ctx.client.keyId.slice(0, 8)}…`),
      ),
      h('button', {
        type: 'button',
        class: 'btn btn-danger btn-block',
        onclick: () => {
          closeSheet();
          ctx.signOut();
        },
      }, 'Sign out & forget key'),
    );
  }

  root.append(
    h('main', { class: 'screen' },
      h('header', { class: 'topbar' },
        logo(30),
        h('div', { class: 'topbar-title' },
          h('h1', null, 'NBA'),
          ctx.env === 'demo' ? h('span', { class: 'chip chip-orange' }, 'Demo') : null,
        ),
        balanceEl,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', onclick: openSettings }, svgIcon('gear')),
      ),
      h('div', { class: 'search' }, svgIcon('search'), search),
      listEl,
    ),
  );

  renderList();
  ctx.refreshBalance = loadBalance;
  const unsubscribe = ctx.store.subscribe(() => loaded && renderList());
  const stops = [poll(load, 15000), poll(loadBalance, 30000)];
  return () => {
    stops.forEach((stop) => stop());
    unsubscribe();
    closeSheet?.();
    ctx.refreshBalance = null;
  };
}
