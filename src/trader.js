// The "favor" flow: buy a team's YES contracts at the current price, then
// immediately rest a sell order on Kalshi at entry + threshold. Because the
// sell order lives on the exchange, it fills the moment the price gets there —
// even if the phone is locked or the app is closed.

import { clampPrice, formatCents, MAX_PRICE, roundToTick } from './kalshi/money.js';
import { quote } from './sports.js';

export class TradeError extends Error {
  constructor(message, code = '') {
    super(message);
    this.name = 'TradeError';
    this.code = code;
  }
}

/**
 * Decide the entry order for one tap.
 * @returns {{limitCents:number, count:number}}
 */
export function planEntry({ askCents, stakeCents, takeProfitCents, slippageCents, priceRanges }) {
  if (askCents == null) throw new TradeError('Nobody is selling this team right now. Try again in a moment.', 'no_ask');
  if (askCents + takeProfitCents > MAX_PRICE) {
    throw new TradeError(`At ${formatCents(askCents)} there's no room for a +${takeProfitCents}¢ target. Lower your target.`, 'no_room');
  }
  // Allow a little slippage so a fast-moving book still fills; the exchange
  // fills at the best available price up to this cap.
  const limitCents = clampPrice(roundToTick(askCents + slippageCents, priceRanges, 'up'));
  const count = Math.floor(stakeCents / limitCents);
  if (count < 1) {
    throw new TradeError(`$${(stakeCents / 100).toFixed(2)} doesn't buy one contract at ${formatCents(limitCents)}. Raise your spend.`, 'stake_low');
  }
  return { limitCents, count };
}

export function targetFor({ entryCents, takeProfitCents, priceRanges }) {
  return clampPrice(roundToTick(entryCents + takeProfitCents, priceRanges, 'up'));
}

export const held = (t) => Math.max(0, t.count - soldCount(t));
export const soldCount = (t) => t.exits.reduce((n, e) => n + e.filled, 0);
export const soldValue = (t) => t.exits.reduce((n, e) => n + e.valueCents, 0);
/** Realized P&L in cents, before fees. */
export const realizedPnl = (t) => soldValue(t) - soldCount(t) * t.entryCents;

/**
 * Trade lifecycle:
 *   open        — target sell order is resting on Kalshi
 *   unprotected — contracts held with no sell order (placement failed / canceled)
 *   done        — everything sold
 */
export class Trader {
  /** @param {{client: import('./kalshi/client.js').KalshiClient, store: {save:(t:object)=>void}}} deps */
  constructor({ client, store }) {
    this.client = client;
    this.store = store;
    this.busy = new Set();
  }

  async freshMarket(eventTicker, ticker) {
    const event = await this.client.getEvent(eventTicker);
    const market = (event.markets ?? []).find((m) => m.ticker === ticker);
    if (!market) throw new TradeError('This market is no longer available.');
    return market;
  }

  async fillValue(orderId) {
    try {
      const fills = await this.client.getFills(orderId);
      if (!fills.length) return null;
      return fills.reduce((sum, f) => sum + f.count * f.priceCents, 0);
    } catch {
      return null;
    }
  }

  /**
   * One tap of a team's Favor button.
   * @param {{eventTicker:string, side:object, settings:{stakeDollars:number, takeProfitCents:number, slippageCents:number}}} args
   */
  async favor({ eventTicker, side, settings }) {
    const market = await this.freshMarket(eventTicker, side.ticker);
    if (market.status !== 'active') throw new TradeError('Trading on this game is paused right now.');
    const priceRanges = market.price_ranges ?? [];

    const plan = planEntry({
      askCents: quote(market).ask,
      stakeCents: Math.round(settings.stakeDollars * 100),
      takeProfitCents: settings.takeProfitCents,
      slippageCents: settings.slippageCents,
      priceRanges,
    });

    const buy = await this.client.placeOrder({
      ticker: side.ticker,
      side: 'bid',
      count: plan.count,
      priceCents: plan.limitCents,
      timeInForce: 'immediate_or_cancel',
    });
    if (!(buy.filled > 0)) {
      throw new TradeError('The price moved before your order filled. Nothing was bought — tap again.');
    }

    let entryCents = buy.avgPriceCents;
    if (entryCents == null) {
      const value = await this.fillValue(buy.id);
      entryCents = value != null ? value / buy.filled : plan.limitCents;
    }

    const now = Date.now();
    const trade = {
      id: buy.id,
      eventTicker,
      ticker: side.ticker,
      code: side.code,
      name: side.name,
      color: side.color,
      count: buy.filled,
      entryCents,
      entryFeeCents: (buy.avgFeeCents ?? 0) * buy.filled,
      targetCents: targetFor({ entryCents, takeProfitCents: settings.takeProfitCents, priceRanges }),
      priceRanges,
      sellOrderId: null,
      exits: [],
      status: 'unprotected',
      note: '',
      createdAt: now,
      updatedAt: now,
    };
    this.store.save(trade);
    await this.placeTarget(trade);
    return trade;
  }

  /** Rest a sell order for everything still held at the trade's target price. */
  async placeTarget(trade) {
    const count = held(trade);
    if (count <= 0) return this.finish(trade, 'done');
    try {
      const order = await this.client.placeOrder({
        ticker: trade.ticker,
        side: 'ask',
        count,
        priceCents: trade.targetCents,
        timeInForce: 'good_till_canceled',
      });
      trade.sellOrderId = order.id;
      // If the bid already cleared the target, part or all of it fills now.
      trade.exits.push({ orderId: order.id, filled: order.filled, valueCents: order.filled * (order.avgPriceCents ?? trade.targetCents) });
      trade.status = order.remaining > 0 || order.filled < count ? 'open' : 'done';
      trade.note = '';
    } catch (err) {
      trade.status = 'unprotected';
      trade.note = `Bought, but the sell order didn't go through: ${err.message}`;
    }
    return this.finish(trade, trade.status);
  }

  /** Poll the resting target order and record any fills. */
  async refresh(trade) {
    if (trade.status !== 'open' || !trade.sellOrderId || this.busy.has(trade.id)) return trade;
    this.busy.add(trade.id);
    try {
      const before = JSON.stringify([trade.status, trade.exits]);
      await this.syncTarget(trade);
      // Only persist (and notify listeners) when something actually moved.
      if (JSON.stringify([trade.status, trade.exits]) !== before) this.finish(trade, trade.status);
      return trade;
    } finally {
      this.busy.delete(trade.id);
    }
  }

  async syncTarget(trade) {
    const order = await this.client.getOrder(trade.sellOrderId);
    const exit = trade.exits.find((e) => e.orderId === order.id);
    if (exit && order.filled !== exit.filled) {
      exit.filled = order.filled;
      exit.valueCents = order.filled * trade.targetCents;
    }
    if (order.status === 'resting') return;

    if (exit && exit.filled > 0) exit.valueCents = (await this.fillValue(order.id)) ?? exit.valueCents;
    trade.sellOrderId = null;
    if (held(trade) <= 0) {
      trade.status = 'done';
    } else {
      trade.status = 'unprotected';
      trade.note = 'Your sell order was canceled on Kalshi. If the game is over, your contracts settle automatically.';
    }
  }

  /** Bail out: cancel the target and sell whatever is held at the current bid. */
  async sellNow(trade, { slippageCents }) {
    if (this.busy.has(trade.id)) throw new TradeError('Hang on — still updating this trade.');
    this.busy.add(trade.id);
    try {
      if (trade.status === 'open' && trade.sellOrderId) {
        try {
          await this.client.cancelOrder(trade.sellOrderId, trade.ticker);
        } catch (err) {
          // Already filled or canceled; syncTarget below records the final state.
          if (err.status !== 404 && err.status !== 409 && err.status !== 400) throw err;
        }
        await this.syncTarget(trade);
        trade.note = '';
      }

      const count = held(trade);
      if (count <= 0) return this.finish(trade, 'done');

      const market = await this.freshMarket(trade.eventTicker, trade.ticker);
      const { bid } = quote(market);
      if (bid == null) {
        trade.status = 'unprotected';
        trade.note = 'No buyers right now, so nothing was sold. Try again in a moment.';
        this.finish(trade, trade.status);
        throw new TradeError(trade.note);
      }
      const limitCents = clampPrice(roundToTick(bid - slippageCents, market.price_ranges ?? trade.priceRanges, 'down'));
      const order = await this.client.placeOrder({
        ticker: trade.ticker,
        side: 'ask',
        count,
        priceCents: limitCents,
        timeInForce: 'immediate_or_cancel',
        reduceOnly: true,
      });
      trade.exits.push({ orderId: order.id, filled: order.filled, valueCents: order.filled * (order.avgPriceCents ?? limitCents) });

      const left = held(trade);
      if (left <= 0) {
        trade.status = 'done';
        trade.note = '';
      } else {
        trade.status = 'unprotected';
        trade.note = order.filled > 0
          ? `Sold ${order.filled} of ${count}. Tap Sell now again for the rest.`
          : 'The price moved and nothing sold. Tap Sell now again.';
      }
      return this.finish(trade, trade.status);
    } finally {
      this.busy.delete(trade.id);
    }
  }

  finish(trade, status) {
    trade.status = status;
    trade.updatedAt = Date.now();
    this.store.save(trade);
    return trade;
  }
}
