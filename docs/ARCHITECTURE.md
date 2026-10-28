# Architecture

## Foundation (Milestone 0)

One isolated Cloudflare Worker serves plain HTML/CSS/JS assets and health/status JSON. One dedicated D1 database stores scheduled job results and sanitized errors. A five-minute UTC Cron Trigger performs a small database heartbeat. No account-wide settings, DNS, existing Workers, or unrelated databases are changed.

Workers Static Assets serves the dashboard; APIs execute Worker code. Read-only health queries verify migrated schema and scheduler freshness. Only the scheduled handler writes operational data. HTTP requests cannot run jobs or modify state. Structured logs use approved operational fields, never request headers, credentials, raw payloads or arbitrary exception messages.

Mode: live scan/no trade, paper-only, trading disabled. Planned paper capital is $5,000, not a reported broker balance. No broker/LLM dependencies exist. Public foundation status has no account/trade data; add authentication before future private data is exposed.

## Target pipeline

U.S. stock universe → broad market polling → ranked candidates → SEC/news/releases/social → normalization → deduplication → features → deterministic ranking → selected compact LLM bundles → deterministic risk engine → Alpaca paper execution → outcomes → versioned strategy evaluation → dashboard.

The LLM never controls the broker. Orders require deterministic risk approval and link to candidate, events, ranking version, strategy, analysis, risk decision, and execution result. Live-money endpoints are forbidden.

Each source retains source/ingestion timestamps, freshness, reliability, errors and stale status. Missing data stays explicit; stale critical sources reduce confidence or block trading. Session classification must use America/New_York DST and the trading calendar. Premarket/after-hours and penny stocks are first-class; illiquid fills require stricter realism checks.

## Cost and persistence

Use isolated resources in the existing account, no paid-service activation. Bound job/error retention. Prefer cheap polling over broad streaming. Document actual source quotas before integration. Track SQL migrations; remote migration precedes deployment. Record resource IDs and verification evidence in state/deployment docs.
