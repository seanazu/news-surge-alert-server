// src/sim/simulator.ts
import fs from "fs";
import path from "path";
import type { Order, Position } from "../strategy/entry.js";
import { updateExit } from "../strategy/exit.js";

/** Paper-trading fills & CSV export for evaluation. */
export type SimFill = {
  ts: number;
  symbol: string;
  side: "buy" | "sell";
  px: number;
  qty: number;
  reason?: string;
};

export class Simulator {
  fills: SimFill[] = [];
  cash: number;
  positions: Record<string, Position> = Object.create(null);
  realizedPnl = 0;

  constructor(startingCash = 100_000) {
    this.cash = startingCash;
  }

  /** Records an order as an immediate paper fill and updates cash/positions. */
  fill(o: Order) {
    if (!o || o.qty <= 0 || !Number.isFinite(o.px)) return;

    this.fills.push({
      ts: o.ts,
      symbol: o.symbol,
      side: o.side,
      px: o.px,
      qty: o.qty,
    });

    if (o.side === "buy") {
      this.cash -= o.px * o.qty;

      const p = this.positions[o.symbol];
      if (!p) {
        this.positions[o.symbol] = {
          symbol: o.symbol,
          qty: o.qty,
          avg: o.px,
          openTs: o.ts,
          high: o.px,
        };
      } else {
        const newQty = p.qty + o.qty;
        p.avg = (p.avg * p.qty + o.px * o.qty) / newQty;
        p.qty = newQty;
        p.high = Math.max(p.high, o.px);
      }
      return;
    }

    // SELL: reduce/close position; compute realized P&L
    const pos = this.positions[o.symbol];
    if (!pos) return; // ignore sells without a position (or add short logic later)

    const qtyToSell = Math.min(o.qty, pos.qty);
    if (qtyToSell <= 0) return;

    this.cash += o.px * qtyToSell;
    this.realizedPnl += (o.px - pos.avg) * qtyToSell;

    pos.qty -= qtyToSell;
    if (pos.qty === 0) {
      delete this.positions[o.symbol];
    } else {
      // keep avg; update high with sale price
      pos.high = Math.max(pos.high, o.px);
    }
  }

  /**
   * Called on each bar/tick to evaluate exit rules for an open position.
   * If an exit condition is met, records a sell fill, updates cash/P&L, and closes the position.
   */
  tryExit(symbol: string, lastPx: number, now: number) {
    const p = this.positions[symbol];
    if (!p) return;

    const decision = updateExit(p, lastPx, now);
    if (!decision) return;

    const qty = p.qty;
    const sellPx = decision.px;

    this.fills.push({
      ts: now,
      symbol,
      side: "sell",
      px: sellPx,
      qty,
      reason: decision.reason,
    });

    this.cash += sellPx * qty;
    this.realizedPnl += (sellPx - p.avg) * qty;
    delete this.positions[symbol];
  }

  /** Mark-to-market equity given a map of latest prices. */
  equity(mark: Record<string, number> = {}): number {
    const unrealized = Object.values(this.positions).reduce((sum, p) => {
      const px = mark[p.symbol];
      return (
        sum +
        (Number.isFinite(px)
          ? (px - p.avg) * p.qty + p.avg * p.qty
          : p.avg * p.qty)
      );
    }, 0);
    return this.cash + unrealized;
  }

  /** Write fills to CSV for analysis. */
  dumpCSV(filePath: string) {
    const header = "ts,symbol,side,px,qty,reason\n";
    const rows = this.fills
      .map(
        (f) =>
          `${new Date(f.ts).toISOString()},${f.symbol},${f.side},${f.px},${
            f.qty
          },${f.reason ?? ""}`
      )
      .join("\n");

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, header + rows);
  }

  /** Reset simulator state (useful for tests or day roll). */
  reset(startingCash?: number) {
    this.fills = [];
    this.positions = Object.create(null);
    this.realizedPnl = 0;
    if (typeof startingCash === "number") this.cash = startingCash;
  }
}
