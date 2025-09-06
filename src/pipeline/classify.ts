import type { RawItem, ClassifiedItem, EventClass } from "../types.js";

/** Events most often behind ≥50% single-day pops. */
export type HighImpactEvent =
  | "PIVOTAL_TRIAL_SUCCESS"
  | "FDA_MARKETING_AUTH"
  | "FDA_ADCOM_POSITIVE"
  | "REGULATORY_DESIGNATION"
  | "TIER1_PARTNERSHIP"
  | "MAJOR_GOV_CONTRACT"
  | "ACQUISITION_BUYOUT"
  | "IPO_DEBUT_POP"
  | "COURT_WIN_INJUNCTION"
  | "MEME_OR_INFLUENCER"
  | "RESTRUCTURING_OR_FINANCING"
  | "POLICY_OR_POLITICS_TAILWIND"
  | "OTHER";

/** Tier-1 counterparties that commonly cause step-function repricing. */
/** Tier-1 counterparties that commonly cause step-function repricing. */
export const TIER1_COUNTERPARTIES: string[] = [
  // === Big Tech / Hyperscalers ===
  "Nvidia",
  "Microsoft",
  "OpenAI",
  "Apple",
  "Amazon",
  "AWS", // alias of Amazon
  "Google",
  "Alphabet", // alias of Google
  "Meta",
  "Facebook", // alias of Meta
  "Tesla",
  "Oracle",
  "Salesforce",
  "Adobe",
  "IBM",
  "Intel",
  "AMD",
  "Broadcom",
  "Qualcomm",
  "TSMC",
  "Samsung",
  "Cisco",
  "Dell",
  "HPE",
  "Supermicro",
  "Snowflake",
  "Palantir",
  "Siemens",
  "Sony",

  // === Enterprise SaaS / Cloud ===
  "Workday",
  "ServiceNow",
  "Shopify",
  "Twilio",
  "Atlassian",
  "Zoom",
  "Datadog",
  "CrowdStrike",
  "Okta",
  "MongoDB",
  "Cloudflare",
  "Stripe",
  "Block",
  "Square", // alias of Block

  // === Retail / Distribution ===
  "Walmart",
  "Target",
  "Costco",
  "Home Depot",
  "Lowe's",
  "Best Buy",
  "Alibaba",
  "Tencent",
  "JD.com",
  "ByteDance",
  "TikTok", // alias of ByteDance

  // === Defense / Aerospace / Space ===
  "Lockheed Martin",
  "Raytheon",
  "RTX", // alias of Raytheon
  "Boeing",
  "Northrop Grumman",
  "General Dynamics",
  "L3Harris",
  "BAE Systems",
  "Thales",
  "Airbus",
  "SpaceX",
  "NASA",
  "Space Force",
  "USSF", // alias of Space Force
  "DARPA",
  "Department of Defense",
  "DoD", // alias of Department of Defense
  "Army",
  "Navy",
  "Air Force",

  // === Pharma / Biotech Mega-caps ===
  "Pfizer",
  "Merck",
  "Johnson & Johnson",
  "J&J", // alias of Johnson & Johnson
  "Bristol-Myers",
  "BMS", // alias of Bristol-Myers
  "Eli Lilly",
  "Lilly", // alias of Eli Lilly
  "Sanofi",
  "GSK",
  "AstraZeneca",
  "Novo Nordisk",
  "Roche",
  "Novartis",
  "Bayer",
  "Amgen",
  "AbbVie",
  "Takeda",
  "Gilead",
  "Biogen",
  "Regeneron",

  // === Healthcare / Medtech ===
  "Medtronic",
  "Boston Scientific",
  "Abbott",
  "GE Healthcare",
  "Philips",
  "Siemens Healthineers",
  "Intuitive Surgical",

  // === Government / Coverage Bodies ===
  "BARDA",
  "HHS",
  "NIH",
  "CMS",
  "Medicare",
  "VA",
  "FDA",
  "EMA",
  "EC",
  "MHRA",
  "PMDA",

  // === Energy / Industrials ===
  "ExxonMobil",
  "Chevron",
  "BP",
  "Shell",
  "TotalEnergies",
  "Schlumberger",
  "Halliburton",
  "Caterpillar",
  "Deere",
  "GE",
  "Honeywell",
];

/** Regex library for key catalysts. */
const PATTERNS = {
  // Bio/med
  pivotalTrialSuccess: [
    /\b(phase\s*(III|3)|late-?stage)\b.*\b(top-?line|primary endpoint (met|achieved|success)|statistically significant|superior|non-?inferior)\b/i,
    /\b(pivotal|registrational)\b.*\b(success|met|positive|statistically significant)\b/i,
  ],
  fdaMarketingAuth: [
    /\b(FDA|EMA|EC|MHRA|PMDA)\b.*\b(approval|approves|authorized|authorization|clearance|clears|EUA|marketing authorization)\b/i,
    /\b(CE[- ]mark|CE[- ]marking|CE[- ]certificate)\b.*\b(approval|granted|obtained)\b/i,
  ],
  fdaAdcomPositive: [
    /\b(advisory (committee|panel)|AdCom)\b.*\b(votes?|voted|recommend(s|ed))\b.*\b(favor|positive|approval)\b/i,
    /\b(panel votes?\s*(\d{1,2}-\d{1,2})\s*(in favor|to recommend))\b/i,
  ],
  regulatoryDesignation: [
    /\b(RMAT|breakthrough (therapy )?designation|BTD|fast[- ]track|orphan (drug )?designation|PRIME status)\b/i,
  ],

  // Commercial/government proof
  tier1Partnership: [
    new RegExp(
      `\\b(${TIER1_COUNTERPARTIES.map((n) =>
        n.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")
      ).join(
        "|"
      )})\\b.*\\b(partnership|agreement|collaboration|acquire|alliance|deal|licensing|contract|supply|distribution|integration|deployment)\\b`,
      "i"
    ),
  ],
  majorGovContract: [
    /\b(NASA|USSF|Space Force|DoD|Department of Defense|Army|Navy|Air Force|DARPA|BARDA|HHS|NIH|CMS|Medicare|VA)\b.*\b(contract|award|task order|IDIQ|grant|funding|coverage|reimbursement|NCD|LCD)\b/i,
    /\b(contract award(ed)?|IDIQ|\$?\d{2,4}\s*(million|billion)\s*(contract|order|award))\b/i,
  ],

  // Corporate — M&A (more granular)
  mnaBuyoutGeneric: [
    /\b(definitive (merger|agreement)|to\s+be\s+acquired|acquire|acquisition|buyout|take[- ]private|go[- ]private|merger)\b/i,
  ],
  mnaDefinitive: [
    /\b(definitive (merger|agreement|deal)|merger agreement (executed|signed)|entered into (a )?definitive (agreement|merger))\b/i,
  ],
  mnaTenderOffer: [
    /\b(tender offer|exchange offer|commence(s|d)? (an )?offer)\b/i,
  ],
  mnaRevisedOrSweetened: [
    /\b(revise[sd]?|increase[sd]?|raise[sd]?|sweeten(?:s|ed)?|ups?)\b.*\b(offer|bid|proposal|consideration|purchase price)\b/i,
    /\b(offer|bid|proposal)\b.*\b(revise[sd]?|increase[sd]?|sweeten(?:s|ed)?|higher)\b/i,
  ],
  mnaCashAndStock: [
    /\bcash\s*(?:&|and|\/)\s*stock\b/i,
    /\b(cash-and-stock|stock-and-cash)\b/i,
  ],
  mnaPerSharePrice: [/\$\s?\d+(?:\.\d+)?\s*(?:per|\/)\s*share\b/i],
  mnaNonBinding: [
    /\b(non[- ]binding|indicative)\b.*\b(offer|proposal|LOI|letter of intent)\b/i,
  ],
  mnaNegative: [
    /\b(terminates?|terminated|ends|walks away|withdraws?)\b.*\b(merger|deal|agreement|offer|bid)\b/i,
    /\b(rejects?|rejected|declines?)\b.*\b(offer|proposal|bid)\b/i,
    /\b(reduce[sd]?|lower[sd]?)\b.*\b(offer|bid|proposal|consideration)\b/i,
  ],

  // Corporate/other
  ipoDebut: [
    /\b(IPO|debut|lists?|first day of trading)\b.*\b(soar|surge|rall(y|ies)|jumps?|more than (double|doubled))\b/i,
  ],
  restructuringOrFinancing: [
    /\b(debt (restructuring|refinancing|forbearance)|going[- ]concern (removed|resolved)|new (financing|credit facility|investment)|exchange (offer|agreement))\b/i,
  ],

  // Legal / sentiment / policy
  courtWinOrInjunction: [
    /\b(court|appeals? court|judge|ITC|PTAB)\b.*\b(grants?|granted|wins?|overturns?|injunction|stays?|vacates?|favorable (ruling|decision))\b/i,
    /\b(settlement|license agreement)\b.*\b(dispute|litigation|lawsuit|patent)\b/i,
  ],
  memeOrInfluencer: [
    /\b(Roaring Kitty|Keith Gill|meme stock|wallstreetbets|WSB|short squeeze|halted for volatility)\b/i,
    /\b(Nvidia|OpenAI)\b.*\b(mentions?|blog|keynote|featured)\b/i,
  ],
  policyOrPoliticsTailwind: [
    /\b(White House|president|FCC|FTC|DoJ|tariff|policy|regulator|court|injunction|settlement)\b.*\b(approv|rules?|grants?|lifts|exempts?)\b/i,
  ],
};

/** Boosters / guards */
const LARGE_DOLLAR_AMOUNT = /\$?\s?(?:\d{2,4})\s*(?:million|billion)\b/i; // $10M–$9B
const SUPERLATIVE_MOVE_WORD =
  /\b(soar|surge|jump|rall(y|ies)|rocket|double|doubled|triple|tripled)\b/i;

const FALSE_POSITIVE_GUARDS = [
  /\b(shareholder|board|committee)\s+(approval|approved)\b/i, // governance approvals
  /\b(ATM|at-the-market|warrants?|reverse split|compliance|Nasdaq notice)\b/i, // financing/listing noise
  /\b(customs clearance|port clearance)\b/i,
  /\b(memorandum of understanding|MOU)\b/i, // too soft
];

/** Negative M&A news wipes score to zero. */
const MNA_NEGATION = (text: string) =>
  PATTERNS.mnaNegative.some((r) => r.test(text));

type ScoreHit = { label: HighImpactEvent; weight: number; evidence: string };

/** Classify a single headline+body and produce (event, score, reasons). */
function classifyNewsItem(
  title: string,
  body: string
): { event: HighImpactEvent; score: number; reasons: string[] } {
  const text = `${title}\n${body}`;

  if (FALSE_POSITIVE_GUARDS.some((r) => r.test(text))) {
    return { event: "OTHER", score: 0, reasons: ["negation_guard"] };
  }
  if (MNA_NEGATION(text)) {
    // Terminated/rejected/withdrawn offers should not trigger alerts.
    return { event: "OTHER", score: 0, reasons: ["mna_negative"] };
  }

  const hits: ScoreHit[] = [];
  const push = (
    ok: boolean,
    label: HighImpactEvent,
    weight: number,
    evidence: string
  ) => {
    if (ok) hits.push({ label, weight, evidence });
  };

  // Core medical/regulatory
  push(
    PATTERNS.pivotalTrialSuccess.some((r) => r.test(text)),
    "PIVOTAL_TRIAL_SUCCESS",
    10,
    "pivotal_trial"
  );
  push(
    PATTERNS.fdaMarketingAuth.some((r) => r.test(text)),
    "FDA_MARKETING_AUTH",
    10,
    "fda_auth"
  );
  push(
    PATTERNS.fdaAdcomPositive.some((r) => r.test(text)),
    "FDA_ADCOM_POSITIVE",
    8,
    "adcom_positive"
  );
  push(
    PATTERNS.regulatoryDesignation.some((r) => r.test(text)),
    "REGULATORY_DESIGNATION",
    6,
    "designation"
  );

  // Commercial/government proof
  push(
    PATTERNS.tier1Partnership.some((r) => r.test(text)),
    "TIER1_PARTNERSHIP",
    8,
    "tier1_partner"
  );
  push(
    PATTERNS.majorGovContract.some((r) => r.test(text)),
    "MAJOR_GOV_CONTRACT",
    8,
    "gov_contract"
  );

  // Corporate/legal/sentiment
  const mnaGeneric = PATTERNS.mnaBuyoutGeneric.some((r) => r.test(text));
  push(mnaGeneric, "ACQUISITION_BUYOUT", 9, "mna_buyout");

  // M&A specificity boosters (don’t change the event label, just the score)
  const hasDefinitive = PATTERNS.mnaDefinitive.some((r) => r.test(text)); // big boost
  const hasTender = PATTERNS.mnaTenderOffer.some((r) => r.test(text));
  const hasRevised = PATTERNS.mnaRevisedOrSweetened.some((r) => r.test(text)); // e.g., “sweetens offer”
  const hasCashAndStock = PATTERNS.mnaCashAndStock.some((r) => r.test(text));
  const hasPerSharePrice = PATTERNS.mnaPerSharePrice.some((r) => r.test(text));
  const isNonBinding = PATTERNS.mnaNonBinding.some((r) => r.test(text));

  // Other events
  push(
    PATTERNS.ipoDebut.some((r) => r.test(text)),
    "IPO_DEBUT_POP",
    7,
    "ipo"
  );
  push(
    PATTERNS.courtWinOrInjunction.some((r) => r.test(text)),
    "COURT_WIN_INJUNCTION",
    7,
    "court_win"
  );
  push(
    PATTERNS.restructuringOrFinancing.some((r) => r.test(text)),
    "RESTRUCTURING_OR_FINANCING",
    5,
    "restructuring"
  );
  push(
    PATTERNS.memeOrInfluencer.some((r) => r.test(text)),
    "MEME_OR_INFLUENCER",
    6,
    "meme_influencer"
  );
  push(
    PATTERNS.policyOrPoliticsTailwind.some((r) => r.test(text)),
    "POLICY_OR_POLITICS_TAILWIND",
    4,
    "policy"
  );

  if (!hits.length) return { event: "OTHER", score: 0, reasons: [] };

  // Aggregate by label
  const byLabel = new Map<HighImpactEvent, number>();
  const reasons: string[] = [];
  for (const h of hits) {
    byLabel.set(h.label, (byLabel.get(h.label) ?? 0) + h.weight);
    reasons.push(h.evidence);
  }
  let [bestEvent, bestScore] = [...byLabel.entries()].sort(
    (a, b) => b[1] - a[1]
  )[0];

  // --- combo & specificity bonuses (emphasize 50%+ movers) ---
  const labels = new Set(hits.map((h) => h.label));
  if (labels.has("PIVOTAL_TRIAL_SUCCESS") && labels.has("FDA_MARKETING_AUTH"))
    bestScore += 3;
  if (labels.has("TIER1_PARTNERSHIP") && labels.has("MAJOR_GOV_CONTRACT"))
    bestScore += 2;
  if (labels.has("ACQUISITION_BUYOUT")) {
    // M&A gradient of certainty/value delivery:
    if (hasDefinitive) bestScore += 3; // signed deal
    if (hasTender) bestScore += 2; // formal offer mechanism
    if (hasRevised) bestScore += 2; // “sweetened/increased” -> target pops
    if (hasCashAndStock) bestScore += 1; // cash component tends to reprice faster
    if (hasPerSharePrice) bestScore += 1; // explicit per-share consideration
    if (isNonBinding) bestScore -= 3; // LOI-only = softer
    bestScore += 2; // base takeout premium (kept from your original logic)
  }
  if (
    LARGE_DOLLAR_AMOUNT.test(text) &&
    (labels.has("TIER1_PARTNERSHIP") || labels.has("MAJOR_GOV_CONTRACT"))
  )
    bestScore += 2;

  if (SUPERLATIVE_MOVE_WORD.test(title)) bestScore += 1;

  return { event: bestEvent, score: bestScore, reasons };
}

/** Public API: classify a batch of RawItem into ClassifiedItem with interpretable scores. */
export function classify(items: RawItem[]): ClassifiedItem[] {
  return items.map((it) => {
    const { event, score } = classifyNewsItem(it.title, it.summary ?? "");
    return { ...it, klass: event as EventClass, score };
  });
}
