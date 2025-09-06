// src/pipeline/priceConfirm.ts
import { cfg } from "../config.js";
import type { ConfirmSignal } from "../types.js";

/** Rolling window for recent 1-minute volumes (per symbol). */
class RollingWindow {
  private values: number[] = [];
  constructor(private capacity = 60) {}
  push(x: number) {
    this.values.push(x);
    if (this.values.length > this.capacity) this.values.shift();
  }
  last(): number | undefined {
    return this.values.length ? this.values[this.values.length - 1] : undefined;
  }
  mean(): number {
    if (!this.values.length) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }
  std(): number {
    const n = this.values.length;
    if (n <= 1) return 0;
    const m = this.mean();
    const variance =
      this.values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (n - 1);
    return Math.sqrt(variance);
  }
}

/** VWAP accumulator for the current session. */
type VwapAccumulator = { priceVolume: number; volume: number };

const WINDOW_SIZE = Number(process.env.VOL_WINDOW_SIZE ?? 60);

// Per-symbol state
const volumeWindows: Record<string, RollingWindow> = {};
const vwapAccumulators: Record<string, VwapAccumulator> = {};
const referencePrices: Record<string, number> = {};

/** Internal helpers */
function getOrCreateWindow(symbol: string): RollingWindow {
  return (volumeWindows[symbol] ||= new RollingWindow(WINDOW_SIZE));
}
function getOrCreateVwap(symbol: string): VwapAccumulator {
  return (vwapAccumulators[symbol] ||= { priceVolume: 0, volume: 0 });
}

/**
 * Update state on each 1-minute bar.
 * Call this for every symbol’s bar to feed the rolling statistics and VWAP.
 */
export function onAgg(symbol: string, close: number, volume: number) {
  // Rolling volume stats (for z-score)
  const win = getOrCreateWindow(symbol);
  win.push(volume);

  // Session VWAP
  const acc = getOrCreateVwap(symbol);
  acc.priceVolume += close * volume;
  acc.volume += volume;
}

/**
 * Set a reference price once per session (e.g., first seen price or prior close).
 * Used as the baseline for the 1-minute return calculation.
 */
export function setRef(symbol: string, px: number) {
  if (referencePrices[symbol] == null) referencePrices[symbol] = px;
}

/**
 * Compute confirmation metrics and pass/fail gate.
 * Returns vol z-score, 1-minute return vs reference, VWAP deviation, and pass flag.
 */
export function getConfirm(symbol: string, priceNow: number): ConfirmSignal {
  const win = volumeWindows[symbol] ?? new RollingWindow(WINDOW_SIZE);

  const meanVol = win.mean();
  const sdVol = win.std();
  const lastVol = win.last() ?? 0;
  const volZ = sdVol > 0 ? (lastVol - meanVol) / sdVol : 0;

  const acc = vwapAccumulators[symbol];
  const vwapPx =
    acc && acc.volume > 0 ? acc.priceVolume / acc.volume : priceNow;
  const vwapDev = priceNow / vwapPx - 1;

  const ref = referencePrices[symbol] ?? vwapPx;
  const ret1m = priceNow / ref - 1;

  const pass =
    (volZ >= cfg.VOL_Z_MIN && ret1m >= cfg.RET_1M_MIN) ||
    (vwapDev >= cfg.VWAP_DEV_MIN && volZ >= cfg.VOL_Z_MIN - 0.5);

  return {
    symbol,
    ts: Date.now(),
    price: priceNow,
    volZ,
    ret1m,
    vwapDev,
    pass,
  };
}

/** Optional: reset per-symbol intraday state (e.g., at session change). */
export function resetSymbolState(symbol: string) {
  delete volumeWindows[symbol];
  delete vwapAccumulators[symbol];
  delete referencePrices[symbol];
}
