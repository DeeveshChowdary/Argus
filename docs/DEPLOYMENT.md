# Deployment and operations

## Isolated resources

| Resource | Value |
| --- | --- |
| Account | Existing account `45043f37f988b1d90a57e97c57e549d5` |
| Worker | `argus-foundation` |
| Dashboard | https://argus-foundation.readingroom.workers.dev |
| Readiness + D1 + cron status | https://argus-foundation.readingroom.workers.dev/health |
| Liveness | https://argus-foundation.readingroom.workers.dev/health/live |
| Detailed foundation status | https://argus-foundation.readingroom.workers.dev/api/status |
| D1 | `argus-foundation-db`, ID `7643ebbc-df97-4986-87c5-7a924cd1b414`, region ENAM |
| Migration | `migrations/0001_foundation.sql`, schema version 1 |
| Cron | `*/5 * * * *` (UTC, every five minutes) |

Preflight found one existing Worker and one existing D1 with no Argus name collisions. Only the newly named resources above were created/modified. No DNS, custom domains, existing Worker, existing database, or account subscription was modified. Account subscription metadata returned 403, so plan status is not asserted. No paid service or upgrade was activated.

## Local setup

Use Node 24 LTS (Node 22+ supported by tooling) and npm. The committed lockfile pins dependencies.

```sh
npm ci
npm run check
npm test
npm run db:migrate:local
npm run dev
```

Open the local URL printed by Wrangler. The dashboard and D1 are local; no remote market/broker services run. With `--test-scheduled` (included by `npm run dev`), exercise the actual local scheduled handler:

```sh
curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'
npm run smoke -- http://localhost:8787
```

Readiness is 503 until a successful heartbeat; liveness is 200 regardless of D1. A failed/latest error or heartbeat older than 12 minutes degrades readiness. Scheduled timestamps, not processing time, determine freshness. Duplicate scheduled times are idempotent. Job/error retention is seven days; history displays up to 15 runs and 10 sanitized errors. Cleanup runs with successful heartbeats, so retention can temporarily exceed seven days during an outage.

## Production deployment

Read CURRENT_STATE first. Authenticate locally using Wrangler OAuth; never paste credentials into chat/source. In CI, use a narrowly scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment secret. Deployment is intentionally manual; GitHub CI validates without production secrets or remote writes.

```sh
npx wrangler login
npx wrangler whoami
npm run check
npm test
npm run deploy:check
npm run db:migrate:remote
npm run deploy
npm run smoke -- https://argus-foundation.readingroom.workers.dev
```

The checked-in account/database identifiers are resource metadata, not secrets. For another account or an intentionally new installation, first inspect names with `npx wrangler d1 list` and account Worker inventory, choose unused project names, create a new D1 with `npx wrangler d1 create <new-name>`, and update configuration with its returned ID. Do not recreate or rebind this project's existing DB during routine deployment. Do not point migrations at unrelated resources.

Apply remote migrations before deploying dependent code. Do not delete/replace existing tables to fix drift. Inspect `npx wrangler d1 migrations list DB --remote` if uncertain. `wrangler deploy` applies the configured Cron Trigger to this Worker only. Propagation can take up to 15 minutes; wait for an actual cron row in `/api/status`. Never insert a fake success record or treat a manual invocation as proof that production scheduling works.

`--allow-pending-cron` may be passed to the smoke script only for initial diagnostics. It still verifies assets, security headers, D1 schema, safe mode and read-only routes; it does **not** pass final cron acceptance. Run strict smoke without it before declaring Milestone 0 complete.

## Credentials and access

Milestone 0 requires **no runtime secrets**. Cloudflare authentication stays outside the repository. `.env*`, `.dev.vars*`, local state, logs, and dependencies are ignored; only the empty documented `.dev.vars.example` is tracked. Future credentials: copy the example into ignored `.dev.vars` locally and use `npx wrangler secret put NAME` for the Worker when the corresponding milestone is authorized. Never add live broker credentials, tokens to URLs, or frontend secrets.

The M0 dashboard/API are public and read-only, containing only foundation health. All HTTP mutation methods are rejected. No scanner or paper orders exist; $5,000 is planned initial capital, not a live balance. Add authentication before exposing future private account/trade data.

## Logs and failure recovery

Cloudflare Worker Observability retains all foundation invocation logs; `npx wrangler tail argus-foundation` provides live diagnostics. App logs are structured and allowlisted. Exceptions return/throw stable codes, never raw provider errors. A D1 write failure records `HEARTBEAT_FAILED` when the DB remains writable. A complete DB outage may prevent recording the error; logs then include `ERROR_PERSISTENCE_FAILED`. A later successful invocation restores health; historical errors remain visible until retention cleanup.

If health is degraded, inspect last successful scheduled time, errors, Cron Trigger configuration, and applied migrations. Assets should remain available during a DB outage. If Cloudflare quotas are exhausted, operations fail visibly; no trading code exists to proceed with stale information.

## Rollback

Inspect `npx wrangler deployments list` for this configured Worker. Roll back only this Worker with `npx wrangler rollback <previous-version-id>` after checking schema compatibility. Worker rollback does not reverse D1 migrations; use an additive corrective migration. The initial version has no older application deployment to restore. To pause the heartbeat, change only this Worker's `triggers.crons` to `[]` and deploy; readiness will become stale. Restore the five-minute schedule when repaired. Never delete unrelated resources.

## Free-tier budget and references

The heartbeat invokes 288 times/day and retains about 2,016 successful runs at steady state. Inserts/cleanup use indexed queries. A visible dashboard tab polls once/minute and stops polling while hidden; there is no market firehose or external API traffic. No paid plan is required for this small workload. Existing account usage shares quotas; no zero-bill guarantee is inferred from inaccessible subscription metadata.

Official references: [Worker config/assets/observability](https://developers.cloudflare.com/workers/wrangler/configuration/), [Cron Triggers and propagation](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). Recheck quotas before Milestone 1.
