import axios from "axios";
import { cfg } from "../config.js";
import { minutesAgoISO } from "../utils/time.js";
import type { RawItem } from "../types.js";
import { log } from "../logger.js";

/** FinancialModelingPrep press releases (often fast for microcaps). */
export async function fetchFmpPressReleases(): Promise<RawItem[]> {
  if (!cfg.FMP_API_KEY) return [];

  try {
    const { data } = await axios.get(
      "https://financialmodelingprep.com/stable/news/press-releases-latest",
      {
        timeout: 8000,
        params: { limit: 30, apikey: cfg.FMP_API_KEY },
      }
    );

    const cutoff = minutesAgoISO(60); // last 60 minutes
    log.info("[FMP] fetched press releases", {
      articles: Array.isArray(data) ? data.length : 0,
    });
    return (Array.isArray(data) ? data : [])
      .filter((d: any) => d.date >= cutoff)
      .map((d: any) => ({
        id: `${d.symbol}|${d.date}|${d.link}`,
        url: d.link,
        title: d.title,
        summary: d.text,
        source: "fmp_pr",
        publishedAt: d.date,
        symbols: [d.symbol].filter(Boolean),
      }));
  } catch {
    return [];
  }
}
