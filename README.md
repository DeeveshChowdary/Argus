# Argus

A U.S. stock scanner and **paper-only** research system. Milestone 1 adds read-only Alpaca market data; no orders, LLM analysis, or broker execution are enabled.

**Dashboard:** https://argus-foundation.readingroom.workers.dev

**Health:** https://argus-foundation.readingroom.workers.dev/health

Plain JavaScript, Cloudflare Worker + Static Assets, dedicated D1, five-minute schedule. Local planning/state/instruction files remain outside version control.

```sh
npm ci
npm run check
npm test
npm run db:migrate:local
npm run dev
```

For local live data, put Alpaca **paper** credentials in ignored `.dev.vars` using the names in `.dev.vars.example`. Offline tests use fixtures and real local D1, never real credentials. The read-only scanner uses fixed paper/data hosts and explicit IEX coverage. No price filter excludes penny stocks.

Production credentials belong in Cloudflare Secret bindings `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`; only their names are declared in `wrangler.jsonc`. Do not put values in code, configuration, logs, frontend or chat. Scanner control is the non-secret `MARKET_SCAN_ENABLED` variable.

```sh
npm run deploy:check
npm run db:migrate:remote
npm run deploy
npm run smoke -- https://argus-foundation.readingroom.workers.dev --market
```

The scanner polls up to 2,000 universe symbols plus the previous top 20 each run, in batches of at most 500. It displays estimated full-sweep time and observation age; it does not claim all symbols are monitored simultaneously. Closed sessions check the clock every five minutes and refresh snapshots hourly. Universe refreshes daily, using atomic publication; old data remains available on failed refresh with explicit stale/error status.

IEX covers one exchange, so volume/quotes are partial. Historical time-of-day relative volume and realized volatility are unavailable in this snapshot-only version and remain null. Previous-full-session volume ratio and daily range are clearly labeled proxies. Session phases and trading-day/early-close context come from Alpaca clock/calendar. Only fresh pre/post-session trade observations count as extended-hours activity.

Data is read-only at `/api/market` and `/api/status`. Candidate bundles, feature/component scores, source/ingestion timestamps and errors persist in D1. Scan history retains seven days. Trading stays disabled. Stop after Milestone 1 acceptance; later milestones are separate work.
