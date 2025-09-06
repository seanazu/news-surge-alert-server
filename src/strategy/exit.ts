import type { Position } from './entry.js';

/** Exit policy: 50% target, 12% trail from session high, or 30-min time stop. */
export function updateExit(pos: Position, lastPx: number, now: number) {
  pos.high = Math.max(pos.high, lastPx);
  const trail = 0.12; // 12% trail
  const timeStopMin = 30;
  const gain = (lastPx/pos.avg)-1;
  const drawdownFromHigh = (lastPx/pos.high)-1;
  const timePassedMin = (now - pos.openTs)/60000;

  if (drawdownFromHigh <= -trail) return { reason: 'trail', px: lastPx };
  if (gain >= 0.5) return { reason: 'target50', px: lastPx };
  if (timePassedMin >= timeStopMin && gain < 0.03) return { reason: 'time', px: lastPx };
  return null;
}
