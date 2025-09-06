// src/run_realtime.ts
import path from "path";
import { cfg } from "./config.js";
import { EventDB } from "./db/EventDB.js";
import { fetchAllProviders } from "./providers/index.js";
import { classify } from "./pipeline/classify.js";
import { score } from "./pipeline/score.js";
import { PolygonFeed } from "./marketdata/polygon.js"; // ✅ Polygon feed
import { onAgg, setRef, getConfirm } from "./pipeline/priceConfirm.js";
import { simulateEntry } from "./strategy/entry.js";
import { Simulator } from "./sim/simulator.js";
import { log } from "./logger.js";
import { notifyDiscord } from "./notify/discord.js";

const nowIso = () => new Date().toISOString();
const pct = (x: number) => (x * 100).toFixed(2) + "%";

// ---- Preconditions / config echo ----
if (!cfg.POLYGON_API_KEY) {
  throw new Error("Missing Polygon API key in config (POLYGON_API_KEY).");
}
log.info("[BOOT] using DB:", cfg.DB_PATH);
log.info("[BOOT] polygon ws url:", "wss://socket.polygon.io/stocks");
log.info("[BOOT] thresholds:", {
  ALERT_THRESHOLD: cfg.ALERT_THRESHOLD,
  VOL_Z_MIN: cfg.VOL_Z_MIN,
  RET_1M_MIN: cfg.RET_1M_MIN,
  VWAP_DEV_MIN: cfg.VWAP_DEV_MIN,
});
log.info("[BOOT] cadence:", {
  POLL_NEWS_SECONDS: cfg.POLL_NEWS_SECONDS,
  NEWS_LOOKBACK_MINUTES: cfg.NEWS_LOOKBACK_MINUTES ?? 180,
});

// ---- State ----
const eventDb = new EventDB(cfg.DB_PATH);
const simulator = new Simulator();
const watchlist = new Set<string>();

// visibility & liveness
let lastNewsRun = 0;
let lastBarAt = 0;
let barCount = 0;
let simEntryCount = 0;

// Where to dump “backtest” fills continuously
const CSV_PATH = path.resolve(
  "logs",
  `fills-${new Date().toISOString().slice(0, 10)}.csv`
);

// ---- News → watchlist ----
async function newsCycle() {
  const started = Date.now();
  lastNewsRun = started;
  log.info("[NEWS] cycle start", { at: new Date(started).toISOString() });

  try {
    const rawItems = await fetchAllProviders();
    const rawCount = rawItems.length;

    // Ignore stale items (helps on restarts)
    const cutoffMs =
      Date.now() - Number(cfg.NEWS_LOOKBACK_MINUTES ?? 180) * 60_000;
    const filtered = rawItems.filter((i) => {
      const t = Date.parse(i.publishedAt || "");
      return Number.isFinite(t) ? t >= cutoffMs : true;
    });
    const filteredCount = filtered.length;

    const classified = classify(filtered);
    const scored = score(classified);
    const passed = scored.filter((it) => it.score >= cfg.ALERT_THRESHOLD);
    const passCount = passed.length;

    log.info("[NEWS] fetched", {
      rawCount,
      filteredCount,
      passCount,
      lookbackMin: cfg.NEWS_LOOKBACK_MINUTES ?? 180,
    });

    for (const item of passed) {
      const symbol = item.symbols?.[0];
      if (!symbol) {
        log.warn("[NEWS] skip (no symbol)", {
          title: item.title?.slice(0, 120),
        });
        continue;
      }

      const hash = eventDb.makeHash({
        title: item.title,
        url: item.url,
        source: item.source,
      });
      if (eventDb.seen(hash)) {
        log.info("[NEWS] dedupe", { symbol, title: item.title?.slice(0, 100) });
        continue;
      }

      eventDb.save(item);
      watchlist.add(symbol);

      log.info("[NEWS] added to watchlist", {
        symbol,
        klass: item.klass,
        score: item.score.toFixed(2),
        wlSize: watchlist.size,
        title: item.title?.slice(0, 140),
        url: item.url || "",
      });

      // Discord alert for the news itself
      await notifyDiscord(
        `📰 **NEWS** ${symbol} — ${item.klass} (score=${item.score.toFixed(
          2
        )})\n${item.title}\n${item.url || ""}`
      );
    }
  } catch (err) {
    log.error("newsCycle error:", err);
  } finally {
    const tookMs = Date.now() - started;
    log.info("[NEWS] cycle end", { tookMs });
  }
}

// ---- Market data feed (Polygon) ----
const feed = new PolygonFeed(cfg.POLYGON_API_KEY);

// Detailed bar logging (first N, then sampled)
const LOG_EVERY_BAR = false; // set true if you want every bar
const SAMPLE_EVERY_N_BARS = 30; // heartbeat rate when LOG_EVERY_BAR is false

feed.on("agg1m", async (bar) => {
  lastBarAt = Date.now();
  barCount += 1;

  // Log first few bars and then a periodic heartbeat
  if (LOG_EVERY_BAR || barCount <= 3 || barCount % SAMPLE_EVERY_N_BARS === 0) {
    log.info("[BAR]", {
      sym: bar.symbol,
      t: new Date(bar.startTimestamp).toISOString(),
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume,
    });
  }

  // Update rolling stats and reference (used by confirm gate)
  onAgg(bar.symbol, bar.close, bar.volume);
  setRef(bar.symbol, bar.open); // (first time seen in session)

  if (!watchlist.has(bar.symbol)) return;

  const conf = getConfirm(bar.symbol, bar.close);

  // Log confirm metrics anytime symbol is under watch
  log.info("[CONFIRM]", {
    sym: bar.symbol,
    price: bar.close,
    volZ: conf.volZ.toFixed(2),
    ret1m: pct(conf.ret1m),
    vwapDev: pct(conf.vwapDev),
    pass: conf.pass,
    thresholds: {
      VOL_Z_MIN: cfg.VOL_Z_MIN,
      RET_1M_MIN: cfg.RET_1M_MIN,
      VWAP_DEV_MIN: cfg.VWAP_DEV_MIN,
    },
  });

  if (!conf.pass) return;

  const order = simulateEntry(bar.symbol, bar.close, bar.startTimestamp);
  if (order.qty <= 0) {
    log.warn("[SIM-ENTRY] no size (qty<=0), removing from watchlist", {
      sym: bar.symbol,
    });
    watchlist.delete(bar.symbol);
    return;
  }

  simulator.fill(order);
  simEntryCount += 1;

  log.info("[SIM-ENTRY]", {
    sym: bar.symbol,
    qty: order.qty,
    px: order.px,
    volZ: conf.volZ.toFixed(2),
    ret1m: pct(conf.ret1m),
    vwapDev: pct(conf.vwapDev),
    simEntryCount,
  });

  await notifyDiscord(
    `🟢 **SIM ENTRY** ${bar.symbol} qty=${order.qty} @ ${order.px.toFixed(
      2
    )} | ` +
      `volZ=${conf.volZ.toFixed(2)} ret1m=${(conf.ret1m * 100).toFixed(1)}%`
  );

  // Avoid multiple entries on the same headline
  watchlist.delete(bar.symbol);
});

// Polygon status frames: {ev:"status", message/status:string}
feed.on("status", (s: any) => {
  const msg =
    s?.message ?? s?.status ?? (typeof s === "string" ? s : JSON.stringify(s));
  log.info("[WS-STATUS]", msg);
});
feed.on("error", (e) => log.error("[WS-ERROR]", e));

// Periodically flush fills to CSV (continuous “backtest” record)
setInterval(() => {
  try {
    simulator.dumpCSV(CSV_PATH);
    log.info("[CSV] flushed fills", {
      path: CSV_PATH,
      totalFills: simulator.fills.length,
    });
  } catch (e) {
    log.warn("[CSV] flush error", e);
  }
}, 60_000);

// Liveness: warn if connected but not receiving bars (useful during RTH)
setInterval(() => {
  const idleSec = (Date.now() - (lastBarAt || Date.now())) / 1000;
  if (!lastBarAt) {
    log.info(
      "[WS] no bars yet — if outside RTH or on delayed cluster, this can be normal."
    );
  } else if (idleSec > 300) {
    log.warn(
      "[WS] no bars in",
      Math.round(idleSec),
      "s. If during RTH, check entitlement or WS URL."
    );
  }
  if (watchlist.size) {
    log.info("[WL] symbols under watch", {
      count: watchlist.size,
      list: Array.from(watchlist).slice(0, 10),
    });
  }
}, 60_000);

// ---- Boot ----
function start() {
  log.info("Realtime: polling news & confirming with Polygon 1m bars", {
    at: nowIso(),
  });

  // Kick off immediately, then on interval
  newsCycle();
  const pollMs = Math.max(5, cfg.POLL_NEWS_SECONDS) * 1000;
  setInterval(newsCycle, pollMs);

  // Keep the socket alive with a baseline symbol; real names are tracked via watchlist
  const keepAliveTickers = ["SPY"];
  log.info("[BOOT] connecting WS (keepalive):", keepAliveTickers);
  feed.connect([...new Set(keepAliveTickers)]);
}

start();
