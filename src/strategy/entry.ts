export type Order = {
  side: "buy" | "sell";
  symbol: string;
  qty: number;
  ts: number;
  px: number;
  // Optional metadata (safe to ignore elsewhere)
  stopPx?: number;
  notional?: number;
};

export type Position = {
  symbol: string;
  qty: number;
  avg: number;
  openTs: number;
  high: number;
};

/** Risk-based sizing: 1% account risk with nominal stop (8% or $0.50),
 *  with guardrails for tiny prices/liquidity and simple slippage allowance.
 */
export function simulateEntry(
  symbol: string,
  px: number,
  now: number,
  riskPct = 0.01,
  equity = 10_000
): Order {
  // --- Tunables (could be moved to config) ---
  const MIN_NOTIONAL = 50; // avoid dust trades
  const MAX_NOTIONAL = 5_000; // cap single-position exposure
  const MIN_PRICE = 0.5; // avoid sub-penny junk
  const LOT_SIZE = 1; // round to whole shares
  const TICK = 0.01; // min price increment
  const SLIPPAGE = Math.max(0.01, px * 0.0005); // ≥$0.01 or 5bps

  // Price sanity
  const cleanPx = Math.max(MIN_PRICE, Math.round(px / TICK) * TICK);

  // Risk and stop proxy
  const riskBudget = equity * riskPct;
  const stopPx = Math.max(cleanPx * 0.92, cleanPx - 0.5); // 8% or $0.50 below
  const perShareRisk = Math.max(cleanPx - stopPx, 0.01);

  // Raw size from risk
  let qty = Math.floor(riskBudget / perShareRisk);

  // Apply notional caps and minimums
  const maxQtyByNotional = Math.floor(MAX_NOTIONAL / cleanPx);
  qty = Math.max(0, Math.min(qty, maxQtyByNotional));
  if (qty > 0 && qty < LOT_SIZE) qty = LOT_SIZE; // at least 1 share
  if (qty > 0 && qty * cleanPx < MIN_NOTIONAL) {
    // bump to meet MIN_NOTIONAL, but don’t exceed cap
    qty = Math.min(Math.ceil(MIN_NOTIONAL / cleanPx), maxQtyByNotional);
  }

  if (qty <= 0) {
    // No feasible size under constraints; skip entry by returning a zero-qty order
    return { side: "buy", symbol, qty: 0, ts: now, px: cleanPx };
  }

  const entryPx = cleanPx + SLIPPAGE; // add small slippage buffer
  const notional = qty * entryPx;

  return {
    side: "buy",
    symbol,
    qty,
    ts: now,
    px: entryPx,
    stopPx,
    notional,
  };
}
