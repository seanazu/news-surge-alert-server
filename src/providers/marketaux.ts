// src/providers/marketaux.ts
import axios, { AxiosError } from "axios";
import { cfg } from "../config.js";
import type { RawItem } from "../types.js";

const http = axios.create({
  baseURL: "https://api.marketaux.com/v1",
  timeout: Number(process.env.MARKETAUX_TIMEOUT_MS ?? 15000), // env override
  headers: { "User-Agent": "news-surge-bot/1.0" },
});

// Format: "YYYY-MM-DDTHH:mm:ss" (UTC, no ms/Z) — Marketaux-compatible
function fmtISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(
      d.getUTCSeconds()
    )}`
  );
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Single page fetch with retries/backoff on timeout/429/5xx. */
async function fetchPage(
  params: Record<string, any>,
  label: string,
  maxRetries = 3
) {
  let attempt = 0;
  let delay = 900; // ms
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const t0 = Date.now();
    try {
      const { data } = await http.get("/news/all", { params });
      console.info(
        new Date().toISOString(),
        `[Marketaux] ${label} ok in ${Date.now() - t0}ms`
      );
      return data;
    } catch (e) {
      const err = e as AxiosError<any>;
      const status = err.response?.status;
      const isTimeout = err.code === "ECONNABORTED";
      const retriable =
        isTimeout || status === 429 || (status && status >= 500);
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        err.message ||
        "unknown";
      console.warn(new Date().toISOString(), "[Marketaux] page error", {
        label,
        status,
        msg,
      });
      if (!retriable || attempt >= maxRetries) throw err;
      attempt++;
      const jitter = Math.floor(Math.random() * 300);
      const wait = Math.min(15000, delay) + jitter;
      console.info(
        new Date().toISOString(),
        `[Marketaux] retry ${attempt}/${maxRetries} in ${wait}ms`
      );
      await sleep(wait);
      delay *= 2;
    }
  }
}

/**
 * Fetch all Marketaux news since NEWS_LOOKBACK_MINUTES.
 * - Global firehose (not per-ticker).
 * - Paginates, retries politely, and dedupes.
 *
 * You can override defaults via env:
 *   MARKETAUX_MAX_PAGES (default 5)
 *   MARKETAUX_PAGE_LIMIT (default 50; many plans cap 20–50)
 *   MARKETAUX_TIMEOUT_MS (default 15000)
 */
export async function fetchMarketaux(
  maxPages = 2,
  pageLimit = 20
): Promise<RawItem[]> {
  if (!cfg.MARKETAUX_API_KEY) return [];

  const lookbackMin = Number(cfg.NEWS_LOOKBACK_MINUTES ?? 180);
  const published_after = fmtISO(new Date(Date.now() - lookbackMin * 60_000));

  console.info(new Date().toISOString(), "[Marketaux] fetch since", {
    published_after,
    lookbackMin,
    maxPages,
    pageLimit,
  });

  const out: RawItem[] = [];
  let page = 1;

  while (page <= maxPages) {
    try {
      const data = await fetchPage(
        {
          api_token: cfg.MARKETAUX_API_KEY,
          language: "en",
          filter_entities: true,
          entity_types: "equity", // keep results equity-focused
          published_after,
          limit: pageLimit,
          page,
          // Optional: countries: "us,ca",
          // Optional: industries: "Technology,Healthcare,Consumer,Energy,Financial",
          // Optional: sentiment_gte: "0.7",
          // Optional: keywords: "undervalued",
        },
        `page#${page}`
      );

      const items: any[] = Array.isArray(data?.data) ? data.data : [];
      console.info(
        new Date().toISOString(),
        "[Marketaux]",
        `page#${page}`,
        "items:",
        items.length
      );
      if (!items.length) break;

      for (const a of items) {
        const publishedAt: string =
          a.published_at ||
          a.published_on ||
          a.publishedAt ||
          new Date().toISOString();

        const symbols: string[] = (a?.entities || [])
          .filter(
            (e: any) =>
              (e?.type || e?.entity_type) === "equity" &&
              (e?.symbol || e?.ticker)
          )
          .map((e: any) => String(e.symbol || e.ticker).toUpperCase());

        out.push({
          id: a.uuid || a.url || a.title || publishedAt,
          url: a.url,
          title: a.title || "",
          summary: a.description || a.snippet || "",
          source: "marketaux",
          publishedAt,
          symbols,
        });
      }

      // stop early if fewer than requested (last page)
      if (items.length < pageLimit) break;

      page += 1;
      await sleep(150); // polite pause
    } catch (err) {
      // If a page fails permanently, stop paginating to avoid loops
      console.warn(
        new Date().toISOString(),
        "[Marketaux] abort pagination after error on page",
        page
      );
      break;
    }
  }

  // basic dedupe by id
  const seen = new Set<string>();
  const deduped: RawItem[] = [];
  for (const it of out) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    deduped.push(it);
  }

  console.info(
    new Date().toISOString(),
    "[Marketaux] total items after paginate+dedupe:",
    deduped.length
  );
  return deduped;
}
