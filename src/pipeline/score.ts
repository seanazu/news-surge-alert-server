// src/pipeline/score.ts
import type { ClassifiedItem } from "../types.js";

/** Baseline impact by classified event (higher = more likely to cause large pops). */
const BASELINE: Record<string, number> = {
  PIVOTAL_TRIAL_SUCCESS: 0.72,
  FDA_MARKETING_AUTH: 0.7, // approval/EUA/clearance
  FDA_ADCOM_POSITIVE: 0.66,
  REGULATORY_DESIGNATION: 0.54, // BTD/Fast Track/Orphan
  TIER1_PARTNERSHIP: 0.6, // Big Tech/Pharma/Defense/mega-retail
  MAJOR_GOV_CONTRACT: 0.6, // DoD/NASA/USSF/BARDA/NIH/CMS
  ACQUISITION_BUYOUT: 0.62, // takeout premiums
  IPO_DEBUT_POP: 0.55,
  COURT_WIN_INJUNCTION: 0.56,
  MEME_OR_INFLUENCER: 0.5,
  RESTRUCTURING_OR_FINANCING: 0.48,
  POLICY_OR_POLITICS_TAILWIND: 0.44,
  OTHER: 0.2,
};

const LARGE_DOLLAR_AMOUNT = /\$?\s?(?:\d{2,4})\s*(?:million|billion)\b/i;
const SUPERLATIVE_WORDS =
  /\b(record|unprecedented|all-time|exclusive|breakthrough|pivotal)\b/i;
const BIG_MOVE_WORDS = /\b(double|doubled|triple|tripled)\b/i;

/** Interpretable score (0..1) approximating impact potential, aligned with the new classifier labels. */
export function score(items: ClassifiedItem[]): ClassifiedItem[] {
  return items.map((it) => {
    const text = (it.title + " " + (it.summary || "")).toLowerCase();

    // 1) Baseline from event type
    let s = BASELINE[it.klass] ?? BASELINE.OTHER;

    // 2) Boosters
    const isSmallCap =
      (it.marketCap ?? 0) > 0 && (it.marketCap as number) < 1_000_000_000; // <$1B
    if (isSmallCap) s += 0.14; // small caps pop harder
    if (SUPERLATIVE_WORDS.test(text)) s += 0.04; // strong language in PR
    if (LARGE_DOLLAR_AMOUNT.test(text)) s += 0.06; // material $ size mentioned
    if (BIG_MOVE_WORDS.test(text)) s += 0.06; // headline claims double/triple, etc.
    if ((it.symbols?.length || 0) === 1) s += 0.03; // single-name focus

    // 3) Cap at 1.0
    return { ...it, score: Math.min(1, s) };
  });
}
