// src/providers/marketaux.ts
import axios, { AxiosError } from "axios";
import { cfg } from "../config.js";
import type { RawItem } from "../types.js";
import { log } from "../logger.js";

const http = axios.create({
  baseURL: "https://api.marketaux.com/v1",
  timeout: Number(process.env.MARKETAUX_TIMEOUT_MS ?? 15000),
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

function canonicalUrl(input?: string): string {
  if (!input) return "";
  try {
    const u = new URL(input);
    u.hash = "";
    u.search = ""; // drop tracking params
    // normalize trailing slash and host casing
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}`;
  } catch {
    // fallback: strip query/hash crudely
    return String(input).split("#")[0].split("?")[0].replace(/\/+$/, "");
  }
}

function normTitle(t?: string): string {
  return (t || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Single page fetch with retries/backoff on timeout/429/5xx.
async function fetchPage(
  params: Record<string, any>,
  label: string,
  maxRetries = 3
) {
  let attempt = 0;
  let delay = 900;
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
      log.info("ERROR : ", e);
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
 * Global firehose, paginated, retried, and de-duped.
 */
export async function fetchMarketaux(
  maxPages = 1,
  pageLimit = 10
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
  const seen = new Set<string>(); // dedupe as we go
  let page = 1;

  while (page <= maxPages) {
    try {
      const data = await fetchPage(
        {
          api_token: cfg.MARKETAUX_API_KEY,
          language: "en",
          entity_types: "equity",
          symbols: "OCTO,RAPP,FORD,DNTH,HOUR",
          sort: "published_on",
          published_before: fmtISO(new Date(Date.now())),
          limit: pageLimit,
          page,
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

        const url = canonicalUrl(a.url);
        const title = a.title || "";
        const titleNorm = normTitle(title);

        // symbols
        const symbols: string[] = (a?.entities || [])
          .filter(
            (e: any) =>
              (e?.type || e?.entity_type) === "equity" &&
              (e?.symbol || e?.ticker)
          )
          .map((e: any) => String(e.symbol || e.ticker).toUpperCase());

        // Stable key: prefer URL; fallback to (title+date+source)
        const key = url || `${titleNorm}|${publishedAt.slice(0, 19)}|marketaux`;
        if (seen.has(key)) continue;
        seen.add(key);

        // id also prefers URL for cross-run stability
        const id = a.uuid || url || `${title}-${publishedAt}`;

        out.push({
          id,
          url: url || a.url, // keep original if canonicalization failed
          title,
          summary: a.description || a.snippet || "",
          source: "marketaux",
          publishedAt,
          symbols,
        });
      }

      if (items.length < pageLimit) break; // likely last page
      page += 1;
      await sleep(150);
    } catch {
      console.warn(
        new Date().toISOString(),
        "[Marketaux] abort pagination after error on page",
        page
      );
      break;
    }
  }

  console.info(
    new Date().toISOString(),
    "[Marketaux] total items:",
    out.length
  );
  return out;
}
