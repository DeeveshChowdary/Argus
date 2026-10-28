# Test matrix

| Milestone 0 criterion | Evidence | Result |
| --- | --- | --- |
| Worker deploys | Wrangler dry-run; deployed isolated Worker, latest version b1bd0ca1-7436-4bfc-ae8c-aae73ed318c2 | Pass |
| Health responds | Runtime integration; local strict smoke; deployed liveness and schema/status checks | Pass; strict production cron readiness pending |
| D1 read/write | Actual local runtime migrations and scheduled writes; remote migration and schema reads | Pass locally; production scheduled write pending |
| Scheduled invocation | Actual local scheduled handler and Wrangler /__scheduled; production trigger configured | Production Cron Trigger record pending |
| No secrets exposed | 29 source/doc files audited; no credential matches; ignore rules verified; production secret list empty; failure redaction assertions | Pass |
| Dashboard loads | Production HTML/JS/CSS/favicon + CSP smoke; real Chrome desktop/mobile | Pass |
| Failure visibility | D1 outage/schema mismatch, absent/stale/future heartbeat, safe persisted/logged errors, network loss and recovery | Pass |
| Safe interface | Unknown routes/methods denied, no HTTP job trigger/order route, paper-only/trading disabled assertions | Pass |
| Deployment instructions | Local migration/dev/scheduled/strict smoke exercised; remote migration/deployment exercised; rollback guidance documented | Pass |

## Automated runtime checks

`npm test`: 13 integration/unit checks using Node's test runner and stable Miniflare, real workerd and local D1. Covers liveness/readiness, scheduled persistence, idempotency, out-of-order invocations, stale timestamps, retention, failed-write persistence/retry, total outage and safe logs, schema mismatch, HTTP mutation rejection, HEAD/assets, invalid/future freshness, and isolated deployment config/static asset references. No provider mocks substitute for local D1.

`npm run check`: JS syntax. `npm run deploy:check`: Wrangler bundle and binding validation. `npm run smoke -- URL`: actual HTTP/asset headers, D1 schema/readiness, real persisted heartbeat, no-trade configuration and read-only endpoints. Initial `--allow-pending-cron` diagnostics do not satisfy final acceptance.

GitHub Actions runs npm ci, syntax, runtime tests, local migration and deployment dry-run on pushes/PRs. No production credentials or remote writes in CI. Workflow execution is not claimed until a GitHub run is observed.

## Browser verification

Real installed Chrome + existing local Playwright used against deployment on 2026-10-27 (America/New_York). Desktop 1440×1100 and mobile 390×844: page/DB status load, zero horizontal overflow, no uncaught JavaScript errors. Intercepted status-network failure shows disconnected/stale warning; removing the interception and refreshing recovers. Screenshots inspected locally. Browser tooling is not an application dependency.

## Later milestones

Add adapter fixtures/stale failures, dedupe/provenance, ranking reproducibility, LLM schema/failure closure, paper endpoint allowlist/risk boundaries, outcome/learning replay and rollback with their milestones. No milestone relies exclusively on manual testing.
