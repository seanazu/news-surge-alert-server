// src/pipeline/score.ts
import type { ClassifiedItem } from "../types.js";

/** Baseline impact by classified event (higher = more likely to cause large pops). */
const BASELINE: Record<string, number> = {
  PIVOTAL_TRIAL_SUCCESS: 0.72,
  FDA_MARKETING_AUTH: 0.7,
  FDA_ADCOM_POSITIVE: 0.66,
  REGULATORY_DESIGNATION: 0.54,
  TIER1_PARTNERSHIP: 0.6,
  MAJOR_GOV_CONTRACT: 0.6,
  GOVERNMENT_EQUITY_OR_GRANT: 0.58,
  ACQUISITION_BUYOUT: 0.64,
  IPO_DEBUT_POP: 0.55,
  COURT_WIN_INJUNCTION: 0.56,
  MEME_OR_INFLUENCER: 0.5,
  RESTRUCTURING_OR_FINANCING: 0.5,
  POLICY_OR_POLITICS_TAILWIND: 0.44,
  EARNINGS_BEAT_OR_GUIDE_UP: 0.52,
  INDEX_INCLUSION: 0.5,
  UPLISTING_TO_NASDAQ: 0.46,
  OTHER: 0.2,
};

/* --- Lightweight cues --- */
const LARGE_DOLLAR_AMOUNT = /\$?\s?(?:\d{2,4})\s*(?:million|billion)\b/i;
const SUPERLATIVE_WORDS =
  /\b(record|unprecedented|all-time|exclusive|breakthrough|pivotal)\b/i;
const BIG_MOVE_WORDS = /\b(double|doubled|triple|tripled)\b/i;

/** Wire gating (no external deps) */
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
  const t = (text || "").toLowerCase();
  try {
    if (url) {
      const host = new URL(url).hostname.toLowerCase();
      if (WIRE_HOSTS.has(host)) return true;
      if (/^(ir|investors)\./i.test(host)) return true;
    }
  } catch {}
  return WIRE_TOKENS.some((tok) => t.includes(tok.toLowerCase()));
}

/** Hardened low-impact guards */
const RX_PROXY_ADVISOR =
  /\b(ISS|Institutional Shareholder Services|Glass Lewis)\b.*\b(recommend(s|ed)?|support(s|ed)?)\b.*\b(vote|proposal|deal|merger)\b/i;
const RX_VOTE_ADMIN_ONLY =
  /\b(definitive proxy|proxy (statement|materials)|special meeting|annual meeting|extraordinary general meeting|EGM|shareholder vote|record date)\b/i;
const RX_LAWFIRM =
  /\b(class action|securities class action|investor (?:lawsuit|alert|reminder)|deadline alert|shareholder rights law firm|securities litigation|investigat(?:ion|ing)|Hagens Berman|Pomerantz|Rosen Law Firm|Glancy Prongay|Bronstein[, ]+Gewirtz|Kahn Swick|Saxena White|Kessler Topaz|Levi & Korsinsky)\b/i;
const RX_SECURITY_UPDATE =
  /\b(cyber(?:security)?|security|ransomware|data (?:breach|exposure)|cyber[- ]?attack)\b.*\b(update|updated|provid(?:e|es)d? an? update)\b/i;
const RX_INVESTOR_CONFS =
  /\b(participat(e|es|ing)|to participate|will participate)\b.*\b(investor (?:conference|conferences)|conference|fireside chat|non-deal roadshow)\b/i;
const RX_AWARDS =
  /\b(award|awards|winner|wins|finalist|recipient|honoree|recognized|recognition|named (?:as|to) (?:the )?(?:list|index|ranking)|anniversary|celebrat(es|ing|ion)|Respect the Drive)\b/i;

const RX_FIN_RESULTS =
  /\b(financial results|first quarter|second quarter|third quarter|fourth quarter|first half|second half|H1|H2|fiscal (?:Q\d|year) results)\b/i;
const RX_EARNINGS_BEAT =
  /\b(raises?|increas(?:es|ed)|hikes?)\b.*\b(guidance|outlook|forecast)\b|\b(beat[s]?)\b.*\b(consensus|estimates|Street|expectations)\b/i;

/** Bio trial/strong-topline cues */
const RX_PIVOTAL = /\b(phase\s*(iii|3)|late-?stage|pivotal|registrational)\b/i;
const RX_MID_STAGE_WIN =
  /\b(phase\s*(ii|2)|mid[- ]stage)\b.*\b(win|successful|success|met|achieved|statistically significant|primary endpoint)\b/i;
const RX_TOPLINE_STRONG =
  /\b(top-?line|primary endpoint (met|achieved)|statistically significant|p<\s*0?\.\d+)\b/i;

/** Regulatory variants */
const RX_CE_MARK =
  /\b(CE[- ]mark|CE[- ]marking|CE[- ]certificate)\b.*\b(approval|approved|granted|obtained)\b/i;
const RX_510K = /\b(FDA)\b.*\b(510\(k\)|510k)\b.*\b(clearance|clears?)\b/i;
const RX_SUPPLEMENTAL =
  /\b(expanded indication|label (expansion|extension)|supplemental (s?NDA|s?BLA)|sNDA|sBLA)\b/i;

/** Process / conference guards unless strong outcomes or explicit endpoint met in journals */
const RX_REG_PROCESS =
  /\b(Type\s*(A|B|C)\s*meeting|End of Phase\s*(2|II)|EOP2|pre[- ](IND|NDA|BLA)|meeting (minutes|with FDA))\b/i;
const RX_JOURNAL =
  /\b(published (in|on)|publication (in|on))\b.*\b(NEJM|New England Journal of Medicine|Lancet|JAMA|Nature|Science)\b/i;
const RX_CONFERENCE =
  /\b(presents?|presented|to present|poster|abstract|oral presentation)\b.*\b(conference|congress|symposium|meeting)\b/i;

/** M&A specifics */
const RX_MNA_DEFINITIVE =
  /\b(definitive (merger|agreement|deal)|merger agreement (executed|signed)|entered into (a )?definitive (agreement|merger))\b/i;
const RX_MNA_WILL_ACQUIRE = /\b(will|to)\s+acquire\b|\bto be acquired\b/i;
const RX_MNA_PERPRICE =
  /\$\s?\d+(?:\.\d+)?\s*(?:per|\/)\s*share\b|(?:deal|transaction|enterprise|equity)\s+value(?:d)?\s+at\s+\$?\d+(?:\.\d+)?\s*(?:million|billion)\b/i;
const RX_MNA_TENDER =
  /\b(tender offer|exchange offer|commence(s|d)? (an )?offer)\b/i;
const RX_MNA_REVISED =
  /\b(revise[sd]?|increase[sd]?|raise[sd]?|sweeten(?:s|ed)?)\b.*\b(offer|bid|proposal|consideration|purchase price)\b/i;
const RX_MNA_CASHSTOCK =
  /\b(cash[- ]and[- ]stock|cash\s*(?:&|and|\/)\s*stock)\b/i;
const RX_MNA_LOI_ANY = /\b(letter of intent|LOI|non[- ]binding|indicative)\b/i;
const RX_MNA_ADMIN =
  /\b(extend(s|ed|ing)?|extension)\b.*\b(expiration|expiry)\b.*\b(tender offer|offer)\b/i;
const RX_ASSET_SALE =
  /\b(sell(?:s|ing)?|divest(?:s|iture|ing)|dispos(?:e|al))\b.*\b(stake|interest|asset|assets|business|subsidiary|equity position)\b/i;
const RX_PROPERTY_ACQ =
  /\b(acquires?|acquisition of)\b.*\b(property|properties|facility|facilities|building|real estate|inpatient rehabilitation facility|IRF)\b/i;

/** Financing (bearish) + exceptions */
const RX_SHELF_ATM =
  /\b(Form\s*S-3|shelf registration|universal shelf|at[- ]the[- ]market|ATM (program|facility))\b/i;
const RX_FINANCING_DILUTIVE =
  /\b(securities purchase agreement|SPA|registered direct|PIPE|private placement|warrants?|convertible (notes?|debentures?|securities?)|at[- ]the[- ]market|ATM (offering|program|facility)?|equity (offering|raise)|unit (offering|financing)|pricing of (an )?offering)\b/i;
const RX_FINANCING_PREMIUM =
  /\b(premium|above[- ]market|priced at)\b.*\$\d+(?:\.\d+)?/i;
const RX_FINANCING_STRATEGIC =
  /\b(strategic (investment|investor|partner|partnership|financing))\b/i;
const RX_FINANCING_GOING =
  /\b(going[- ]concern (removed|resolved)|debt (extinguished|retired|repaid|eliminated|paid (down|off))|default (cured|resolved))\b/i;
const RX_ANTI_DILUTION_POS =
  /\b(terminates?|terminated|withdraws?|withdrawn|cancels?|cancelled|reduces?|downsized?)\b.*\b(offering|registered direct|ATM|at[- ]the[- ]market|public offering|securities purchase agreement)\b/i;

/** Crypto / treasury */
const RX_CRYPTO_TREASURY_BUY =
  /\b(buy|bought|purchase[sd]?|acquire[sd]?)\b.*\b(Bitcoin|BTC|Ethereum|ETH|Solana|SOL|LINK|Chainlink|crypto(?:currency)?|tokens?)\b/i;
const RX_CRYPTO_TREASURY_DISCUSS =
  /\b(treasury|reserve|policy|program|strategy)\b.*\b(discuss(?:ions?)?|approached|proposal|term sheet|non[- ]binding|indicative)\b.*\b(\$?\d+(?:\.\d+)?\s*(?:million|billion))\b/i;

/** Index inclusion (major vs minor) */
const RX_INDEX_MAJOR = /\b(S&P\s?(500|400|600)|MSCI|FTSE|Nasdaq[- ]?100)\b/i;
const RX_INDEX_MINOR =
  /\b(Russell\s?(2000|3000)|S&P\/?TSX Composite|TSX Composite|TSX Venture|TSXV|CSE Composite)\b/i;

/** Other ≤5% cohort noise */
const RX_ANALYST =
  /\b(initiates?|reiterates?|maintains?|upgrades?|downgrades?)\b.*\b(coverage|rating|price target|pt|target)\b/i;
const RX_MEDIA_INTERVIEW =
  /\b(says|tells|told|said)\b.*\b(CNBC|Yahoo Finance|Bloomberg|Fox Business|Barron'?s)\b/i;
const RX_BUYBACK_DIV =
  /\b(share repurchase|buyback|dividend (declaration|increase|initiation))\b/i;

// Strategic alternatives
const RX_STRAT_ALTS =
  /\b(strategic alternatives?|exploring (alternatives|options)|review of strategic alternatives|considering strategic alternatives)\b/i;

// Tier-1 powered-by verbs and Tier-1 names
const RX_TIER1_VERBS =
  /\b(powered by|built (?:on|with)|integrat(?:es|ed)? with|adopt(?:s|ed)|selects?|standardiz(?:es|ed) on|deploys?|rolls out)\b/i;
const TIER1_RX = new RegExp(
  "\\b(?:Nvidia|Microsoft|OpenAI|Apple|Amazon|AWS|Google|Alphabet|Meta|Facebook|Tesla|Oracle|Salesforce|Adobe|IBM|Intel|AMD|Broadcom|Qualcomm|TSMC|Samsung|Cisco|Dell|HPE|Supermicro|Snowflake|Palantir|Siemens|Sony|Workday|ServiceNow|Shopify|Twilio|Atlassian|Zoom|Datadog|CrowdStrike|Okta|MongoDB|Cloudflare|Stripe|Block|Square|Walmart|Target|Costco|Home Depot|Lowe's|Best Buy|Alibaba|Tencent|JD.com|ByteDance|TikTok|Lockheed Martin|Raytheon|RTX|Boeing|Northrop Grumman|General Dynamics|L3Harris|BAE Systems|Thales|Airbus|SpaceX|NASA|Space Force|USSF|DARPA|Department of Defense|DoD|Army|Navy|Air Force|Pfizer|Merck|Johnson & Johnson|J&J|Bristol-Myers|BMS|Eli Lilly|Lilly|Sanofi|GSK|AstraZeneca|Novo Nordisk|Roche|Novartis|Bayer|Amgen|AbbVie|Takeda|Gilead|Biogen|Regeneron|Medtronic|Boston Scientific|Abbott|GE Healthcare|Philips|Siemens Healthineers|Intuitive Surgical|BARDA|HHS|NIH|CMS|Medicare|VA|FDA|EMA|EC|MHRA|PMDA|ExxonMobil|Chevron|BP|Shell|TotalEnergies|Schlumberger|Halliburton|Caterpillar|Deere|GE|Honeywell)(?:'s)?\\b",
  "i"
);

// Listing compliance regained
const RX_LISTING_COMPLIANCE =
  /\b(regain(?:ed|s)?|returns? to|back in)\b.*\b(compliance)\b.*\b(Nasdaq|NYSE|listing)\b/i;

// Preclinical signals
const RX_PRECLIN_NHP =
  /\b(non[- ]?human|nonhuman)\s+primate[s]?\b.*\b(well tolerated|tolerability|safety|safe)\b.*\b(higher than|exceed(?:s|ed)|above)\b.*\b(efficacious|effective)\b/i;
const RX_CELL_MODEL =
  /\b(patient[- ]derived|iPSC|neurons?|organoid[s]?)\b.*\b(early (signals?|evidence) of (benefit|efficacy)|signal(?:s)? of (benefit|efficacy)|improv(?:e|ed)|rescue)\b/i;
const RX_HOT_DISEASE =
  /\b(Alzheimer'?s|ALS|Parkinson'?s|Huntington'?s|multiple sclerosis|MS\b|glioblastoma|GBM|pancreatic cancer)\b/i;

// Special dividend (explicit amount)
const RX_SPECIAL_DIVIDEND =
  /\b(special (cash )?dividend)\b.*\$\s?\d+(?:\.\d+)?\s*(?:per|\/)\s*share|\b(special (cash )?dividend of)\s*\$\s?\d+(?:\.\d+)?\b/i;

// Misinformation / unauthorized PR
const RX_MISINFO =
  /\b(misinformation|unauthorized (press )?release|retracts? (?:a )?press release|clarif(?:y|ies) misinformation)\b/i;

export function score(items: ClassifiedItem[]): ClassifiedItem[] {
  return items.map((it) => {
    const blob = `${it.title ?? ""} ${it.summary ?? ""}`;
    const isWire = isWirePR((it as any).url, blob);

    // 0) Hard suppress misinformation
    if (RX_MISINFO.test(blob)) {
      return { ...it, score: 0 };
    }

    // 1) Baseline
    let s = BASELINE[it.klass] ?? BASELINE.OTHER;

    // 2) Early caps for frequent non-catalysts
    if (RX_PROXY_ADVISOR.test(blob) || RX_VOTE_ADMIN_ONLY.test(blob))
      s = Math.min(s, 0.2);
    if (RX_LAWFIRM.test(blob)) s = Math.min(s, 0.12);
    if (RX_AWARDS.test(blob)) s = Math.min(s, 0.18);
    if (RX_SECURITY_UPDATE.test(blob)) s = Math.min(s, 0.16);
    if (RX_INVESTOR_CONFS.test(blob)) s = Math.min(s, 0.16);

    // Generic ≤5% noise caps
    if (RX_ANALYST.test(blob) || RX_MEDIA_INTERVIEW.test(blob))
      s = Math.min(s, 0.16);
    if (RX_SHELF_ATM.test(blob)) s = Math.min(s, 0.18);

    // IMPORTANT: don't cap when it's a SPECIAL dividend
    const isSpecialDividend = RX_SPECIAL_DIVIDEND.test(blob);
    if (!isSpecialDividend && RX_BUYBACK_DIV.test(blob)) s = Math.min(s, 0.2);

    if (RX_STRAT_ALTS.test(blob)) s = Math.min(s, 0.3);

    // 3) Dilutive financing suppression (unless clear positives)
    const isPlainDilutive =
      /\b(securities purchase agreement|SPA|registered direct|PIPE|private placement|unit (offering|financing)|equity (offering|raise)|convertible (note|debenture|security)|warrants?)\b/i.test(
        blob
      ) &&
      !(
        RX_FINANCING_PREMIUM.test(blob) ||
        RX_FINANCING_STRATEGIC.test(blob) ||
        RX_FINANCING_GOING.test(blob)
      );
    if (isPlainDilutive) s = Math.min(s, 0.18);

    // 4) Bio nuance
    if (String(it.klass) === "PIVOTAL_TRIAL_SUCCESS") {
      if (RX_PIVOTAL.test(blob)) s += 0.05;
      else if (RX_MID_STAGE_WIN.test(blob)) s += 0.05;
      if (!RX_TOPLINE_STRONG.test(blob)) s -= 0.05;

      // Preclinical boosts
      if (RX_PRECLIN_NHP.test(blob)) s += 0.06;
      if (RX_CELL_MODEL.test(blob))
        s += RX_HOT_DISEASE.test(blob) ? 0.06 : 0.04;

      // Journal synergy: NEJM/Lancet + explicit endpoint/met p-value
      const journalStrong =
        RX_JOURNAL.test(blob) && RX_TOPLINE_STRONG.test(blob);
      if (journalStrong) s += 0.04;
    }

    // 5) Approvals split (cap lighter EU/510k/supplemental)
    if (String(it.klass) === "FDA_MARKETING_AUTH") {
      if (RX_CE_MARK.test(blob)) s = Math.min(s, 0.46);
      if (RX_510K.test(blob)) s = Math.min(s, 0.46);
      if (RX_SUPPLEMENTAL.test(blob)) s = Math.min(s, 0.58);
    }

    // 6) Process/journal/conference guards (unless strong outcomes)
    const hasStrongOutcome =
      RX_TOPLINE_STRONG.test(blob) ||
      RX_PIVOTAL.test(blob) ||
      RX_MID_STAGE_WIN.test(blob);
    if (!hasStrongOutcome) {
      if (RX_REG_PROCESS.test(blob)) s = Math.min(s, 0.42);
      if (RX_JOURNAL.test(blob)) s = Math.min(s, 0.42);
      if (RX_CONFERENCE.test(blob)) s = Math.min(s, 0.38);
    }

    // 7) M&A specifics — allow off-wire definitive
    if (String(it.klass) === "ACQUISITION_BUYOUT") {
      const definitive =
        RX_MNA_DEFINITIVE.test(blob) ||
        (RX_MNA_WILL_ACQUIRE.test(blob) && RX_MNA_PERPRICE.test(blob));
      if (definitive) s += 0.06;
      if (RX_MNA_TENDER.test(blob)) s += 0.04;
      if (RX_MNA_REVISED.test(blob)) s += 0.06;
      if (RX_MNA_CASHSTOCK.test(blob)) s += 0.02;
      if (RX_MNA_PERPRICE.test(blob)) s += 0.02;

      if (RX_MNA_LOI_ANY.test(blob)) s -= 0.06;
      if (RX_MNA_ADMIN.test(blob)) s = Math.min(s, 0.4);
      if (RX_ASSET_SALE.test(blob) || RX_PROPERTY_ACQ.test(blob))
        s = Math.min(s, 0.4);
    }

    // 8) Gov contracts: routine follow-on cap
    if (
      String(it.klass) === "MAJOR_GOV_CONTRACT" &&
      /\b(continued production|follow[- ]on|followon|option (exercise|exercised)|extension|renewal)\b/i.test(
        blob
      )
    )
      s = Math.min(s, 0.48);

    // 9) Index inclusion: major vs minor
    if (String(it.klass) === "INDEX_INCLUSION") {
      if (RX_INDEX_MAJOR.test(blob)) s += 0.04;
      if (RX_INDEX_MINOR.test(blob)) s = Math.min(s, 0.4);
    }

    // 10) Wire presence modulation for catalyst-y labels
    const label = String(it.klass);
    const wireSensitive =
      label === "PIVOTAL_TRIAL_SUCCESS" ||
      label === "FDA_MARKETING_AUTH" ||
      label === "FDA_ADCOM_POSITIVE" ||
      label === "TIER1_PARTNERSHIP" ||
      label === "MAJOR_GOV_CONTRACT" ||
      label === "GOVERNMENT_EQUITY_OR_GRANT" ||
      label === "ACQUISITION_BUYOUT" ||
      label === "EARNINGS_BEAT_OR_GUIDE_UP" ||
      label === "INDEX_INCLUSION" ||
      label === "UPLISTING_TO_NASDAQ";

    // Off-wire allowed when (a) definitive M&A or (b) Tier-1 powered-by verbs
    const tier1Powered = TIER1_RX.test(blob) && RX_TIER1_VERBS.test(blob);
    if (wireSensitive) {
      const definitiveMnaOffWire =
        label === "ACQUISITION_BUYOUT" &&
        !isWire &&
        (RX_MNA_DEFINITIVE.test(blob) ||
          (RX_MNA_WILL_ACQUIRE.test(blob) && RX_MNA_PERPRICE.test(blob)));
      if (!(definitiveMnaOffWire || tier1Powered)) {
        if (isWire) s += 0.04;
        else s = Math.min(s, 0.48);
      }
    }

    // 11) Crypto treasury — allow without capital raise
    const isCryptoBuy = RX_CRYPTO_TREASURY_BUY.test(blob);
    const isCryptoDiscuss = RX_CRYPTO_TREASURY_DISCUSS.test(blob);
    if (
      label === "RESTRUCTURING_OR_FINANCING" ||
      isCryptoBuy ||
      isCryptoDiscuss
    ) {
      if (isCryptoBuy) s += 0.14;
      if (isCryptoDiscuss) s += 0.1;
      if (LARGE_DOLLAR_AMOUNT.test(blob)) s += 0.04;
    }

    // 12) Generic results cap unless beat/raise OR strong exceptions
    const pctMatch = blob.match(
      /\b(revenue|sales|eps|earnings|arr|bookings|net income)\b[^.%]{0,90}?\b(up|increase[sd]?|grow[n|th|s]?|jump(?:ed)?|soar(?:ed)?|surged)\b[^%]{0,25}?(\d{2,3})\s?%(\s*(y\/y|yoy|year[- ]over[- ]year|q\/q|qoq))?/i
    );
    const hasBigPct = pctMatch?.[3]
      ? !isNaN(parseInt(pctMatch[3], 10)) && parseInt(pctMatch[3], 10) >= 50
      : false;
    const swingProfit =
      /\b(returns?|returned|swing|swung|back)\s+to\s+(profit|profitability|positive (?:net )?income)\b/i.test(
        blob
      );

    if (RX_FIN_RESULTS.test(blob) && !RX_EARNINGS_BEAT.test(blob)) {
      if (hasBigPct || swingProfit) s += swingProfit ? 0.1 : 0.08;
      else s = Math.min(s, 0.32);
    }

    // 13) Positive financing exception
    if (RX_ANTI_DILUTION_POS.test(blob)) s += 0.12;

    // 14) Listing compliance regained
    if (RX_LISTING_COMPLIANCE.test(blob)) s += 0.12;

    // 15) Special cash dividend (explicit amount)
    if (isSpecialDividend) s += 0.14;

    // 16) Generic boosters
    const isSmallCap =
      (it.marketCap ?? 0) > 0 && (it.marketCap as number) < 1_000_000_000; // <$1B
    if (isSmallCap) s += 0.14;
    if (SUPERLATIVE_WORDS.test(blob)) s += 0.04;
    if (LARGE_DOLLAR_AMOUNT.test(blob)) s += 0.06;
    if (BIG_MOVE_WORDS.test(blob)) s += 0.06;
    if ((it.symbols?.length || 0) === 1) s += 0.03;

    // Bound [0,1]
    s = Math.max(0, Math.min(1, s));
    return { ...it, score: s };
  });
}
