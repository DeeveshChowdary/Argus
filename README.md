# Argus

An incremental U.S. stock-scanning and **paper-only** research system. Current scope: **Milestone 0**, infrastructure and operations. No market ingestion, LLM analysis, or orders are enabled.

**Dashboard:** https://argus-foundation.readingroom.workers.dev

**Health:** https://argus-foundation.readingroom.workers.dev/health

Read [current state](docs/CURRENT_STATE.md) before starting work. See the [execution plan](docs/EXECUTION_PLAN.md), [architecture](docs/ARCHITECTURE.md), [deployment runbook](docs/DEPLOYMENT.md), [test matrix](docs/TEST_MATRIX.md), and [original request](docs/PROJECT_BRIEF.md).

```sh
npm ci
npm run check
npm test
npm run db:migrate:local
npm run dev
```

Plain JavaScript, Cloudflare Worker + Static Assets, one dedicated D1, five-minute scheduled heartbeat. Public foundation dashboard is read-only. Milestone 1 starts only after Milestone 0 acceptance and the requested stop/report.
