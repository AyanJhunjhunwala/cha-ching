import { formatCents, formatUsd } from '../kalshi/money.js';
import { formatMove } from '../live.js';
import { groupByDay, isLive, matchesSearch, parseGame, sportByKey, sportForEvent, SPORTS, startsInLabel, startTimeLabel, timingByEvent } from '../sports.js';
import { clampSetting, loadSportKey, saveSettings, saveSportKey } from '../store.js';
import { sheet, stepper } from './controls.js';
import { h, liveBadge, logo, poll, svgIcon, toast } from './dom.js';

/** Scrollable list of open games for the chosen sport; tap one to trade it. */
export function renderMarkets(root, ctx) {
  let sport = sportByKey(loadSportKey());
  let games = ctx.gamesBySport[sport.key] ?? [];
  let loaded = sport.key in ctx.gamesBySport;
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

  // Price cells by market ticker, so pushed quotes update the list in place.
  const priceCells = new Map();

  // Live games show how far each team moved in the last 5 minutes: "▲3".
  function paintMove(cell) {
    if (!cell.move) return;
    const change = ctx.tape.change(cell.side.ticker);
    const cents = Math.round(Math.abs(change?.delta ?? 0));
    const dir = cents ? formatMove(change).dir : 'flat';
    cell.move.textContent = cents ? `${dir === 'up' ? '▲' : '▼'}${cents}` : '';
    cell.move.dataset.dir = dir;
  }

  function teamRow(side, live) {
    const price = h('span', { class: 'team-price' }, formatCents(side.ask ?? side.last));
    const move = live ? h('span', { class: 'team-move', title: 'Change in the last 5 minutes' }) : null;
    const cell = { el: price, side, move };
    priceCells.set(side.ticker, cell);
    paintMove(cell);
    return h('div', { class: 'team-row' },
      h('span', { class: 'team-dot', style: { background: side.color } }),
      h('span', { class: 'team-code' }, side.code),
      h('span', { class: 'team-name' }, side.name),
      move,
      price,
    );
  }

  const offTicker = ctx.stream.on('ticker', (t) => {
    const cell = priceCells.get(t.ticker);
    if (!cell) return;
    const before = cell.side.ask ?? cell.side.last;
    for (const k of ['bid', 'ask', 'last']) if (t[k] !== undefined) cell.side[k] = t[k];
    const after = cell.side.ask ?? cell.side.last;
    paintMove(cell);
    if (after === before) return;
    cell.el.textContent = formatCents(after);
    if (before != null && after != null) {
      cell.el.classList.remove('tick-up', 'tick-down');
      void cell.el.offsetWidth; // restart the flash
      cell.el.classList.add(after > before ? 'tick-up' : 'tick-down');
    }
  });

  function gameCard(game) {
    const open = ctx.store.openCount(game.eventTicker);
    const live = isLive(game);
    const time = startsInLabel(game) || startTimeLabel(game);
    return h('button', { type: 'button', class: `game-card${live ? ' is-live' : ''}`, onclick: () => ctx.openGame(game) },
      h('div', { class: 'game-teams' }, teamRow(game.away, live), teamRow(game.home, live)),
      h('div', { class: 'game-meta' },
        live ? liveBadge() : time ? h('span', { class: 'game-time' }, time) : null,
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
      if (t.status === 'done' || listed.has(t.eventTicker) || sportForEvent(t.eventTicker) !== sport) continue;
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
    priceCells.clear();
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
        : emptyState('No games open', `Kalshi has no ${sport.label} games open for trading right now. Check back closer to game time.`));
      return;
    }
    for (const group of groupByDay(visible)) {
      listEl.append(h('h2', { class: `day-label${group.live ? ' live-label' : ''}` }, group.label), ...group.games.map(gameCard));
    }
  }

  async function load() {
    const requested = sport;
    try {
      const { events, milestones } = await ctx.client.listEvents(requested.series);
      const timing = timingByEvent(milestones);
      ctx.gamesBySport[requested.key] = events.map((e) => parseGame(e, requested, timing.get(e.event_ticker))).filter(Boolean);
      if (requested !== sport) return; // the user switched sports while this was loading
      games = ctx.gamesBySport[requested.key];
      ctx.stream.setMarkets(games.flatMap((g) => [g.away.ticker, g.home.ticker]));
      for (const side of games.flatMap((g) => [g.away, g.home])) {
        if (!ctx.stream.streaming || !ctx.tape.has(side.ticker)) ctx.tape.recordQuote(side.ticker, side);
      }
      loadError = '';
    } catch (err) {
      if (requested !== sport) return;
      loadError = err.message;
      if (loaded) toast(err.message, 'error');
    }
    loaded = true;
    renderList();
  }

  const feedText = h('span');
  const feedEl = h('div', { class: 'feed', role: 'status' }, h('span', { class: 'feed-dot', 'aria-hidden': 'true' }), feedText);
  function updateFeed() {
    const status = ctx.stream.status;
    feedEl.dataset.state = status === 'live' ? 'live' : status === 'unsupported' ? 'poll' : 'retry';
    feedText.textContent = status === 'live'
      ? 'Live feed · prices update as they change'
      : status === 'unsupported' ? 'Prices refresh every 10s' : 'Connecting live feed · refreshing every 10s';
  }
  updateFeed();

  const sportTabs = SPORTS.map((s) =>
    h('button', {
      type: 'button',
      class: 'seg-btn',
      'aria-pressed': String(s === sport),
      onclick: () => selectSport(s),
    }, `${s.icon} ${s.label}`),
  );

  function selectSport(next) {
    if (next === sport) return;
    sport = next;
    saveSportKey(sport.key);
    sportTabs.forEach((tab, i) => tab.setAttribute('aria-pressed', String(SPORTS[i] === sport)));
    games = ctx.gamesBySport[sport.key] ?? [];
    loaded = sport.key in ctx.gamesBySport;
    loadError = '';
    renderList();
    load();
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
          h('h1', null, 'Games'),
          ctx.env === 'demo' ? h('span', { class: 'chip chip-orange' }, 'Demo') : null,
        ),
        balanceEl,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', onclick: openSettings }, svgIcon('gear')),
      ),
      h('div', { class: 'seg sport-tabs', role: 'group', 'aria-label': 'Sport' }, sportTabs),
      feedEl,
      h('div', { class: 'search' }, svgIcon('search'), search),
      listEl,
    ),
  );

  renderList();
  if (games.length) ctx.stream.setMarkets(games.flatMap((g) => [g.away.ticker, g.home.ticker]));
  ctx.refreshBalance = loadBalance;
  const unsubscribe = ctx.store.subscribe(() => loaded && renderList());
  // Prices stream in; the REST reload picks up new games and status changes.
  const listPoll = poll(load, () => (ctx.stream.streaming ? 20000 : 10000));
  const offStatus = ctx.stream.on('status', (status) => {
    updateFeed();
    if (status !== 'live') listPoll.now();
  });
  const stops = [listPoll, poll(loadBalance, 30000)];
  return () => {
    stops.forEach((stop) => stop());
    unsubscribe();
    offTicker();
    offStatus();
    closeSheet?.();
    ctx.refreshBalance = null;
  };
}
