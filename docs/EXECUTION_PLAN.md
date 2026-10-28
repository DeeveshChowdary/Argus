# Execution plan

Before every task read CURRENT_STATE and relevant architecture/decisions. Implement → test → fix → deploy → verify production → update docs/state → commit. Code alone never completes a milestone. Do not start unrelated work while current acceptance fails.

| Milestone | Scope | Acceptance gate |
| --- | --- | --- |
| 0 (current) | Worker, isolated D1, migration, config/secrets structure, logging/errors, heartbeat, dashboard | Deployed Worker/health, real D1 read/write, actual scheduled run, no secret exposure, dashboard loads, documented deployment, automated checks |
| 1 | Alpaca data, U.S. tradable universe including penny stocks, bounded polling, persisted ranked snapshots | Live universe/candidates, extended-hours detection where available, scheduled scans, dashboard, visible failures |
| 2 | SEC plus reliable free catalyst source, unified schema, ticker mapping and dedupe | Live filings/news, normalized/grouped events, candidate timeline |
| 3 | Authorized Reddit, spam filter, historical baselines | Persisted mention/comment acceleration, sentiment delta, session context and dashboard |
| 4 | Deterministic explainable ranking | Stored inputs/components/version, reproducible ranks and reasons |
| 5 | Filtered structured LLM, optional constrained second opinion | Validated schema, exact event provenance, cost/latency, safe failures, escalation |
| 6 | Alpaca paper execution and risk engine | Size/concurrency/liquidity/spread/staleness/duplicate/loss/drawdown/penny guards, kill switch, failure handling, provenance/rejections |
| 7 | All-signal outcomes and controlled learning | Traded/rejected/catalyst/confidence comparisons, versioned reversible weights with measured evidence |
| 8 | Complete operations dashboard | Health, market, intelligence, trading, learning, errors and ranking changes |

Stop after Milestone 0 passes; no Alpaca/Reddit/LLM integration yet. Future modes: live scan/no trade, live paper, historical replay where practical, dry-run orders. Never live money.
