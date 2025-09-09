// src/pipeline/classify.ts
// Hardened, dependency-free rules tuned from your examples and numbers file.
// Blocks: proxy-advisor recs, law-firm “deadline alerts,” awards/celebrations,
// cybersecurity-incident updates, investor-conference participation,
// and plain “financial results” with no beat/raise.
// Treats Russell joins as low-signal (scored as minor downstream).
// Allows: crypto-treasury buys/pivots & large treasury-discussions (even without a capital raise);
// definitive M&A even off-wire when per-share/valuation is present;
// Tier-1 “signed/enters into/inks agreement/contract/MOU,” even off-wire.

import type { RawItem, ClassifiedItem, EventClass } from "../types.js";

/** Events commonly behind ≥40–50% single-day pops. */
export type HighImpactEvent =
  | "PIVOTAL_TRIAL_SUCCESS"
  | "FDA_MARKETING_AUTH"
  | "FDA_ADCOM_POSITIVE"
  | "REGULATORY_DESIGNATION"
  | "TIER1_PARTNERSHIP"
  | "MAJOR_GOV_CONTRACT"
  | "GOVERNMENT_EQUITY_OR_GRANT"
  | "ACQUISITION_BUYOUT"
  | "IPO_DEBUT_POP"
  | "COURT_WIN_INJUNCTION"
  | "MEME_OR_INFLUENCER"
  | "RESTRUCTURING_OR_FINANCING"
  | "POLICY_OR_POLITICS_TAILWIND"
  | "EARNINGS_BEAT_OR_GUIDE_UP"
  | "INDEX_INCLUSION"
  | "UPLISTING_TO_NASDAQ"
  | "OTHER";

/** Tier-1 counterparties (exact list you provided). */
const TIER1_COUNTERPARTIES: string[] = [
  "Nvidia",
  "Microsoft",
  "OpenAI",
  "Apple",
  "Amazon",
  "AWS",
  "Google",
  "Alphabet",
  "Meta",
  "Facebook",
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
  "Square",
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
  "TikTok",
  "Lockheed Martin",
  "Raytheon",
  "RTX",
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
  "USSF",
  "DARPA",
  "Department of Defense",
  "DoD",
  "Army",
  "Navy",
  "Air Force",
  "Pfizer",
  "Merck",
  "Johnson & Johnson",
  "J&J",
  "Bristol-Myers",
  "BMS",
  "Eli Lilly",
  "Lilly",
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
  "Medtronic",
  "Boston Scientific",
  "Abbott",
  "GE Healthcare",
  "Philips",
  "Siemens Healthineers",
  "Intuitive Surgical",
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

/* ---------- Utils ---------- */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = (s: string) =>
  (s || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\u2011|\u2013|\u2014/g, "-")
    .trim();

const TIER1_RX = new RegExp(
  `\\b(?:${TIER1_COUNTERPARTIES.map(esc).join("|")})(?:'s)?\\b`,
  "i"
);

/** “True PR” gate: major wire hosts or boilerplate tokens; allow issuer IR. */
const WIRE_HOSTS = new Set([
  "www.prnewswire.com",
  "www.globenewswire.com",
  "www.businesswire.com",
  "www.accesswire.com",
  "www.newsfilecorp.com",
]);
const WIRE_TOKENS = [
  "PR Newswire",
  "GlobeNewswire",
  "Business Wire",
  "ACCESSWIRE",
  "Newsfile",
];
function isWirePR(url?: string, text?: string): boolean {
  const t = normalize(text || "");
  try {
    if (url) {
      const host = new URL(url).hostname.toLowerCase();
      if (WIRE_HOSTS.has(host)) return true;
      // allow common issuer IR subdomains
      if (/^(ir|investors)\./i.test(host)) return true;
    }
  } catch {}
  return WIRE_TOKENS.some((tok) => t.includes(tok));
}

/* ---------- Patterns ---------- */
const PAT = {
  // Bio
  pivotal:
    /\b(phase\s*(iii|3)|pivotal|registrational)\b.*\b(success|met (?:the )?primary endpoint|statistically significant)\b/i,
  topline:
    /\b(top-?line)\b.*\b(positive|met (?:the )?primary endpoint|statistically significant)\b/i,
  adcom:
    /\b(advisory (committee|panel)|adcom)\b.*\b(vote|voted|recommends?)\b/i,
  approval:
    /\b(FDA|EMA|EC|MHRA|PMDA)\b.*\b(approved?|approval|authorized|authorization|clearance|clears|EUA|510\(k\))\b/i,
  designation:
    /\b(breakthrough therapy|BTD|fast[- ]track|orphan (drug )?designation|PRIME|RMAT)\b/i,

  // M&A (binding allowed off-wire if definitive + price/value present)
  mnaBinding:
    /\b(definitive (agreement|merger)|merger agreement (executed|signed)|entered into (a )?definitive (agreement|merger)|business combination|to be acquired|take[- ]private|go[- ]private|acquisition|buyout|tender|exchange offer)\b/i,
  mnaWillAcquire: /\b(will|to)\s+acquire\b|\bto be acquired\b/i,
  mnaPerShareOrValue:
    /\$\s?\d+(?:\.\d+)?\s*(?:per|\/)\s*share\b|(?:deal|transaction|enterprise|equity)\s+value(?:d)?\s+at\s+\$?\d+(?:\.\d+)?\s*(?:million|billion|bn|mm|m)\b/i,
  mnaNonBinding: /\b(non[- ]binding|indicative|letter of intent|LOI)\b/i,
  mnaAdminOnly: /\b(extend(s|ed|ing)?|extension)\b.*\b(tender offer|offer)\b/i,
  mnaAssetOrProperty:
    /\b(divestiture|asset sale|dispos(?:e|al)|acquisition of (?:property|facility|real estate|inpatient rehabilitation))\b/i,

  // Partnerships / contracts
  partnershipAny:
    /\b(partner(ship)?|strategic (?:alliance|partnership)|collaborat(?:e|ion)|distribution|licen[cs]e|supply|integration|deployment)\b/i,
  dealSigned:
    /\b(signed|signs|inks?|enters? into)\b.*\b(agreement|deal|contract|MOU|memorandum of understanding)\b/i,
  contractAny: /\b(contract|award|task order|IDIQ|grant|funding)\b/i,
  govWords:
    /\b(NASA|USSF|Space Force|DoD|Department of Defense|Army|Navy|Air Force|DARPA|BARDA|HHS|NIH|CMS|Medicare|VA)\b/i,
  govEquity:
    /\b(?:government|DoD|Department of Defense|HHS|BARDA)\b.*\b(preferred (stock|equity)|equity|investment|warrants?)\b/i,

  // Corporate / other
  earningsBeatGuideUp:
    /\b(raises?|increas(?:es|ed)|hikes?)\b.*\b(guidance|outlook|forecast)\b|\b(beat[s]?)\b.*\b(consensus|estimates|Street|expectations)\b/i,
  indexInclusion:
    /\b(added|to be added|to join|inclusion|included)\b.*\b(Russell\s?(2000|3000)|MSCI|S&P\s?(500|400|600)|S&P Dow Jones Indices|FTSE)\b/i,
  uplist:
    /\b(uplisting|uplist|approved to list)\b.*\b(Nasdaq|NYSE|NYSE American)\b/i,

  // Legal / meme
  courtWin:
    /\b(court|judge|ITC|PTAB)\b.*\b(grants?|wins?|injunction|vacates?|stays?)\b/i,
  memeOrInfluencer:
    /\b(Roaring Kitty|Keith Gill|meme stock|wallstreetbets|WSB|short squeeze|Jensen Huang|Nvidia (blog|mention))\b/i,

  // Name-drop only context
  nameDropContext:
    /\b(mention(?:ed)?|blog|keynote|showcase|featured|ecosystem|catalog|marketplace)\b/i,

  // Low-impact cohorts to hard-block
  proxyAdvisor:
    /\b(ISS|Institutional Shareholder Services|Glass Lewis)\b.*\b(recommend(s|ed)?|support(s|ed)?)\b.*\b(vote|proposal|deal|merger)\b/i,
  voteAdminOnly:
    /\b(definitive proxy|proxy (statement|materials)|special meeting|annual meeting|extraordinary general meeting|EGM|shareholder vote|record date)\b/i,
  lawFirmPR:
    /\b(class action|securities class action|investor (?:lawsuit|alert|reminder)|deadline alert|shareholder rights law firm|securities litigation|investigat(?:ion|ing)|Hagens Berman|Pomerantz|Rosen Law Firm|Glancy Prongay|Bronstein[, ]+Gewirtz|Kahn Swick|Saxena White|Kessler Topaz|Levi & Korsinsky)\b/i,
  awardsPR:
    /\b(award|awards|winner|wins|finalist|recipient|honoree|recognized|recognition|named (?:as|to) (?:the )?(?:list|index|ranking)|anniversary|celebrat(es|ing|ion)|Respect the Drive)\b/i,
  securityIncidentUpdate:
    /\b(cyber(?:security)?|security|ransomware|data (?:breach|exposure)|cyber[- ]?attack)\b.*\b(update|updated|provid(?:e|es)d? an? update)\b/i,
  investorConfs:
    /\b(participat(e|es|ing)|to participate|will participate)\b.*\b(investor (?:conference|conferences)|conference|fireside chat|non-deal roadshow)\b/i,

  // Generic “financial results” text (suppressed unless beat/raise matches above)
  financialResultsOnly:
    /\b(financial results|first quarter|second quarter|third quarter|fourth quarter|first half|second half|H1|H2|fiscal (?:Q\d|year) results)\b/i,

  // Financing / dilution guards
  shelfOrATM:
    /\b(Form\s*S-3|shelf registration|at[- ]the[- ]market|ATM (program|facility))\b/i,
  plainDilution:
    /\b(securities purchase agreement|registered direct|PIPE|private placement|unit financing|equity offering|warrants?)\b/i,

  // Misc noise (kept for completeness & parity with scorer)
  strategicAlts:
    /\b(explore|evaluat(?:e|ing)|commence(?:s|d)?)\b.*\b(strategic alternatives|strategic review)\b/i,
  conferenceOnly:
    /\b(presents?|to present|poster|abstract|oral presentation|fireside chat|non-deal roadshow|conference|corporate update)\b/i,
  upcomingOnly:
    /\b(KOL|key opinion leader)\b.*\b(event|webcast|call)\b|\b(upcoming|will (announce|report)|to (announce|report))\b.*\b(data|results|top-?line)\b/i,
  analystMedia:
    /\b(says|said|told|interview)\b.*\b(CNBC|Yahoo Finance|Bloomberg|Fox Business|Barron'?s)\b/i,
  bidAuction:
    /\b(bid|proposal)\b.*\b(auction|court[- ]supervised|bankruptcy)\b/i,
  govRoutine:
    /\b(continued production|follow[- ]on|option (exercise|exercised)|extension|renewal)\b/i,
  typoErratum: /\b(typo|erratum|correction|corrects|amended release)\b/i,

  // Crypto / treasury catalysts
  cryptoTreasuryBuy:
    /\b(buy|bought|purchase[sd]?|acquire[sd]?)\b.*\b(Bitcoin|BTC|Ethereum|ETH|Solana|SOL|LINK|Chainlink|crypto(?:currency)?|tokens?)\b/i,
  cryptoTreasuryDiscuss:
    /\b(treasury|reserve|policy|program|strategy)\b.*\b(discuss(?:ions?)?|approached|proposal|term sheet|non[- ]binding|indicative)\b.*\b(\$?\d+(?:\.\d+)?\s*(?:million|billion|bn|mm|m))\b/i,
};

const LARGE_DOLLARS = /\$?\s?(?:\d{2,4})\s*(?:million|billion|bn|mm|m)\b/i;
const SCALE =
  /\b(multi[- ]year|nationwide|global|enterprise[- ]wide|rollout)\b/i;

type ScoreHit = { label: HighImpactEvent; w: number; why: string };

function classifyOne(it: RawItem): { event: HighImpactEvent; score: number } {
  const title = normalize(it.title || "");
  const body = normalize(it.summary || "");
  const x = `${title}\n${body}`;
  const url = (it as any).url as string | undefined;

  // --- Hard guards / early exits ---
  if (PAT.securityIncidentUpdate.test(x)) return { event: "OTHER", score: 0 };
  if (PAT.awardsPR.test(x)) return { event: "OTHER", score: 0 };
  if (
    (PAT.proxyAdvisor.test(x) || PAT.voteAdminOnly.test(x)) &&
    !PAT.mnaBinding.test(x)
  )
    return { event: "OTHER", score: 0 };
  if (PAT.investorConfs.test(x)) return { event: "OTHER", score: 0 };
  if (PAT.lawFirmPR.test(x)) return { event: "OTHER", score: 0 };
  if (PAT.shelfOrATM.test(x)) return { event: "OTHER", score: 0 };
  if (PAT.analystMedia.test(x)) return { event: "OTHER", score: 0 };
  if (PAT.typoErratum.test(x)) return { event: "OTHER", score: 0 };

  // Plain dilution (unless premium/strategic) → near zero
  if (
    PAT.plainDilution.test(x) &&
    !/premium|above[- ]market|strategic investor/i.test(x)
  )
    return { event: "OTHER", score: 0.1 };

  const isPR = isWirePR(url, x);
  const hits: ScoreHit[] = [];
  const push = (
    ok: boolean,
    label: HighImpactEvent,
    w: number,
    why: string
  ) => {
    if (ok) hits.push({ label, w, why });
  };

  // --- Positive rules ---

  // Bio / regulatory (wire preferred)
  if (isPR) {
    push(PAT.approval.test(x), "FDA_MARKETING_AUTH", 10, "approval");
    push(PAT.adcom.test(x), "FDA_ADCOM_POSITIVE", 8, "adcom_positive");
    push(
      PAT.pivotal.test(x) || PAT.topline.test(x),
      "PIVOTAL_TRIAL_SUCCESS",
      9,
      "pivotal_or_topline"
    );
    push(PAT.designation.test(x), "REGULATORY_DESIGNATION", 6, "designation");
  }

  // M&A: allow off-wire if definitive language + per-share/valuation present
  {
    const binding =
      PAT.mnaBinding.test(x) ||
      (PAT.mnaWillAcquire.test(x) && PAT.mnaPerShareOrValue.test(x));
    const nonbind = PAT.mnaNonBinding.test(x);
    const admin = PAT.mnaAdminOnly.test(x);
    const asset = PAT.mnaAssetOrProperty.test(x);
    push(
      binding && !nonbind && !admin && !asset,
      "ACQUISITION_BUYOUT",
      9,
      "mna_binding"
    );
    if (nonbind || admin || asset) push(true, "OTHER", 2, "mna_low_impact");
  }

  // Gov / partnerships (Tier-1 deal can pass off-wire if signed/inked/enters into)
  {
    const govContract = PAT.govWords.test(x) && PAT.contractAny.test(x);
    const govEquity = PAT.govEquity.test(x);
    const isPartnership =
      PAT.partnershipAny.test(x) ||
      PAT.contractAny.test(x) ||
      PAT.dealSigned.test(x);
    const hasTier1 = TIER1_RX.test(x);
    const hasScale = LARGE_DOLLARS.test(x) || SCALE.test(x);

    if (isPR && govContract && !PAT.govRoutine.test(x))
      push(true, "MAJOR_GOV_CONTRACT", 8, "gov_contract");
    if (isPR && govContract && PAT.govRoutine.test(x))
      push(true, "OTHER", 2, "gov_routine");
    push(govEquity, "GOVERNMENT_EQUITY_OR_GRANT", 9, "gov_equity");

    const nameDropOnly =
      hasTier1 && PAT.nameDropContext.test(x) && !isPartnership;
    if (isPartnership && (hasTier1 || hasScale) && !nameDropOnly)
      push(
        true,
        "TIER1_PARTNERSHIP",
        hasTier1 ? 8 : 6,
        hasTier1 ? "tier1" : "scale"
      );
    if (!isPartnership && nameDropOnly)
      push(true, "MEME_OR_INFLUENCER", 4, "tier1_name_drop_only");
  }

  // Corporate (earnings require beat/raise tokens; Russell will be minor in scorer)
  {
    push(
      PAT.earningsBeatGuideUp.test(x),
      "EARNINGS_BEAT_OR_GUIDE_UP",
      6,
      "earnings"
    );
    if (PAT.indexInclusion.test(x))
      push(true, "INDEX_INCLUSION", 3, "index_inclusion");
    push(PAT.uplist.test(x), "UPLISTING_TO_NASDAQ", 5, "uplist");
  }

  // Legal / meme
  push(PAT.courtWin.test(x), "COURT_WIN_INJUNCTION", 6, "court");
  push(PAT.memeOrInfluencer.test(x), "MEME_OR_INFLUENCER", 6, "influencer");

  // Crypto / treasury catalysts (allow without capital raise)
  if (PAT.cryptoTreasuryBuy.test(x))
    push(true, "RESTRUCTURING_OR_FINANCING", 7, "crypto_treasury_buy");
  if (PAT.cryptoTreasuryDiscuss.test(x))
    push(true, "RESTRUCTURING_OR_FINANCING", 6, "crypto_treasury_discuss");

  // Generic results suppression (no beat/raise/outlook)
  if (PAT.financialResultsOnly.test(x) && !PAT.earningsBeatGuideUp.test(x)) {
    push(true, "OTHER", -4, "generic_fin_results_only");
  }

  if (!hits.length) return { event: "OTHER", score: 0 };

  const by = new Map<HighImpactEvent, number>();
  for (const h of hits) by.set(h.label, (by.get(h.label) ?? 0) + h.w);

  // Synergies / boosters
  if (by.has("PIVOTAL_TRIAL_SUCCESS") && by.has("FDA_MARKETING_AUTH"))
    by.set("FDA_MARKETING_AUTH", (by.get("FDA_MARKETING_AUTH") ?? 0) + 3);
  if (
    (by.has("TIER1_PARTNERSHIP") ||
      by.has("MAJOR_GOV_CONTRACT") ||
      by.has("GOVERNMENT_EQUITY_OR_GRANT")) &&
    (LARGE_DOLLARS.test(x) || SCALE.test(x))
  )
    by.set("OTHER", (by.get("OTHER") ?? 0) + 2);

  const total = [...by.values()].reduce((a, b) => a + b, 0);
  const strongCatalyst =
    (by.get("ACQUISITION_BUYOUT") ?? 0) >= 8 ||
    (by.get("FDA_MARKETING_AUTH") ?? 0) >= 8 ||
    (by.get("PIVOTAL_TRIAL_SUCCESS") ?? 0) >= 8 ||
    (by.get("MAJOR_GOV_CONTRACT") ?? 0) >= 8 ||
    (by.get("RESTRUCTURING_OR_FINANCING") ?? 0) >= 7;

  if (total <= 0 && !strongCatalyst) return { event: "OTHER", score: 0 };

  const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  const event = top ? (top[0] as HighImpactEvent) : "OTHER";
  const score = top ? top[1] : 0;

  return { event, score };
}

/** Public API */
export function classify(items: RawItem[]): ClassifiedItem[] {
  return items.map((it) => {
    const { event, score } = classifyOne(it);
    return { ...it, klass: event as EventClass, score };
  });
}
