# Argus

An incremental U.S. stock-scanning and **paper-only** research system. Current scope: **Milestone 0**, infrastructure and operations. No market ingestion, LLM analysis, or orders are enabled.

**Dashboard:** https://argus-foundation.readingroom.workers.dev

**Health:** https://argus-foundation.readingroom.workers.dev/health

Local development instructions and planning/state files are kept outside version control. See below for application setup and verification.

```sh
npm ci
npm run check
npm test
npm run db:migrate:local
npm run dev
```

Plain JavaScript, Cloudflare Worker + Static Assets, one dedicated D1, five-minute scheduled heartbeat. Public foundation dashboard is read-only. Milestone 1 starts only after Milestone 0 acceptance and the requested stop/report.
