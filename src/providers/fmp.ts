// src/pipeline/fetchFmpPressReleases.ts
import axios from "axios";
import { cfg } from "../config.js";
import { minutesAgoISO } from "../utils/time.js";
import type { RawItem } from "../types.js";
import { log } from "../logger.js";

/** Params for press-release fetch + market-cap filter. */
interface FetchFmpPressReleasesParams {
  /** How many paginated PR pages to pull from FMP (50 items per page). */
  maxPages?: number;
  /** Keep PRs whose issuer market cap is >= this (in USD). Omit to disable lower bound. */
  minMarketCap?: number;
  /** Keep PRs whose issuer market cap is <= this (in USD). Omit to disable upper bound. */
  maxMarketCap?: number;
  /**
   * If true, keep PRs when we *can’t* resolve a market cap for the symbol.
   * If false, drop those PRs. Defaults to false (be strict).
   */
  includeUnknownMktCap?: boolean;
  /** Only keep PRs published within the last N minutes. Set 0/undefined to skip time filter. */
  lookbackMinutes?: number;
}

/** --- Small helper: fetch market caps for a set of symbols (batched) --- */
async function fetchMarketCaps(
  symbols: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!symbols.length || !cfg.FMP_API_KEY) return out;

  // FMP supports comma-separated symbols on /api/v3/quote; chunk conservatively.
  const chunkSize = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += chunkSize) {
    chunks.push(symbols.slice(i, i + chunkSize));
  }

  for (const chunk of chunks) {
    try {
      const { data } = await axios.get(
        "https://financialmodelingprep.com/api/v3/quote/" + chunk.join(","),
        { params: { apikey: cfg.FMP_API_KEY }, timeout: 8000 }
      );
      // Expected shape: [{ symbol: "AAPL", marketCap: 3.9e12, ... }, ...]
      if (Array.isArray(data)) {
        for (const row of data) {
          const sym = String(row?.symbol || "").trim();
          const cap = Number(row?.marketCap);
          if (sym) out.set(sym, Number.isFinite(cap) ? cap : NaN);
        }
      }
    } catch (e) {
      log.warn("[FMP] error fetching market caps", {
        symbols: chunk,
        error: e,
      });
    }
  }
  return out;
}

/** FinancialModelingPrep press releases (often fast for microcaps), with market-cap filtering. */
export async function fetchFmpPressReleases(
  params: FetchFmpPressReleasesParams = {}
): Promise<RawItem[]> {
  const {
    maxPages = 2,
    minMarketCap = 5_000_000,
    maxMarketCap = 600_000_000,
    includeUnknownMktCap = false,
    lookbackMinutes = 60, // default: last 60 minutes
  } = params;

  const out: RawItem[] = [];
  if (!cfg.FMP_API_KEY) return out;

  // 1) Pull press releases (paged)
  for (let page = 1; page <= maxPages; page++) {
    try {
      const { data } = await axios.get(
        "https://financialmodelingprep.com/stable/news/press-releases-latest",
        {
          timeout: 8000,
          params: { limit: 1000, page, apikey: cfg.FMP_API_KEY },
        }
      );

      const cutoffISO = lookbackMinutes
        ? minutesAgoISO(lookbackMinutes)
        : undefined;

      const items = (Array.isArray(data) ? data : [])
        .filter((d: any) => {
          if (!cutoffISO) return true;
          const dt = String(d?.date || d?.publishedDate || "");
          return dt && dt >= cutoffISO;
        })
        .map((d: any) => ({
          id: `${d.symbol}|${d.date || d.publishedDate}|${d.url || d.link}`,
          url: d.url || d.link,
          title: d.title,
          summary: d.text,
          source: "fmp_pr",
          publishedAt: d.date || d.publishedDate,
          symbols: [d.symbol].filter(Boolean),
        })) as RawItem[];

      out.push(...items);

      log.info("[FMP] fetched press releases page", {
        page,
        articles: items.length,
      });
    } catch (e) {
      log.warn("[FMP] error fetching press releases", { page, error: e });
    }
  }

  log.info("[FMP] total raw PR items", { items: out.length });
  if (!out.length) return out;

  // 2) Resolve market caps for all unique symbols, then filter
  const uniqueSymbols = Array.from(
    new Set(out.flatMap((it) => (Array.isArray(it.symbols) ? it.symbols : [])))
  ).filter(Boolean);

  const capMap = await fetchMarketCaps(uniqueSymbols);

  // Helper: check if an item passes the cap filter
  const passesCapFilter = (item: RawItem): boolean => {
    const sym = item.symbols?.[0];
    if (!sym) return includeUnknownMktCap; // no symbol present

    const cap = capMap.get(sym);
    if (!Number.isFinite(cap)) return includeUnknownMktCap;

    if (typeof minMarketCap === "number" && cap! < minMarketCap) return false;
    if (typeof maxMarketCap === "number" && cap! > maxMarketCap) return false;
    return true;
  };

  const filtered = out.filter(passesCapFilter);

  return filtered;
}

const APIKEY = cfg.FMP_API_KEY; // <-- your key

/**
 * Returns true IFF:
 * 1) The symbol is listed on a major US exchange (NASDAQ/NYSE family/Cboe) AND price >= $1 AND actively trading
 * 2) The EXACT 5m bar at `publishedAt` (interpreted using `inputZone`) is at least `threshold` ×
 *    the avg-per-5m of the prior trading day’s midday 4h bar.
 *
 * @param symbol e.g. "TSLA"
 * @param publishedAt e.g. "2025-09-09 16:03:00" (no tz)
 * @param options.threshold default 3
 * @param options.inputZone "utc" | "America/New_York" (how to interpret `publishedAt` if it has no tz; default "utc")
 * @param options.allowZeroFallback if the exact 5m has vol=0, step back a few bars; default true
 */
// Map FMP long names to canonical short forms
const canon = (raw = "") => {
  const u = raw.toUpperCase().trim();
  const map: Record<string, string> = {
    NASDAQ: "NASDAQ",
    "NASDAQ GLOBAL SELECT": "NASDAQGS",
    "NASDAQ GLOBAL MARKET": "NASDAQGM",
    "NASDAQ CAPITAL MARKET": "NASDAQCM",
    "NEW YORK STOCK EXCHANGE": "NYSE",
    NYSE: "NYSE",
    "NEW YORK STOCK EXCHANGE ARCA": "NYSE ARCA",
    "NYSE ARCA": "NYSE ARCA",
    "NEW YORK STOCK EXCHANGE AMERICAN": "NYSE AMERICAN",
    "NYSE AMERICAN": "NYSE AMERICAN",
    AMEX: "AMEX",
    BATS: "BATS",
    "CBOE BZX": "CBOE BZX",
    "CBOE BYX": "CBOE BYX",
    "CBOE EDGA": "CBOE EDGA",
    "CBOE EDGX": "CBOE EDGX",
  };
  if (map[u]) return map[u];
  if (u.includes("GLOBAL SELECT")) return "NASDAQGS";
  if (u.includes("GLOBAL MARKET")) return "NASDAQGM";
  if (u.includes("CAPITAL MARKET")) return "NASDAQCM";
  if (u.includes("ARCA")) return "NYSE ARCA";
  if (u.includes("AMERICAN")) return "NYSE AMERICAN";
  return raw;
};

export async function isExchangeOk(symbol: string): Promise<boolean> {
  try {
    const url = `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(
      symbol
    )}?apikey=${APIKEY}`;
    const r = await axios.get(url);
    const p = Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
    if (!p) return false;

    const allowed = new Set([
      "NASDAQ",
      "NASDAQGS",
      "NASDAQGM",
      "NASDAQCM",
      "NYSE",
      "NYSE ARCA",
      "NYSE AMERICAN",
      "AMEX",
      "BATS",
      "CBOE BZX",
      "CBOE BYX",
      "CBOE EDGA",
      "CBOE EDGX",
    ]);

    const exOk = allowed.has(canon(p.exchange));
    const activeOk = (p.isActivelyTrading ?? true) === true;
    const priceOk = (p.price ?? 0) >= 1; // filter out penny stocks

    return exOk && activeOk && priceOk;
  } catch {
    return false;
  }
}
