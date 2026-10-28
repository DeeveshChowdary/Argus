# Decisions

| ID | Decision | Reason / consequence |
| --- | --- | --- |
| D001 | Milestone 0 only, no broker/LLM integration | Verify infrastructure before market features. |
| D002 | Deploy directly into user's existing Cloudflare account | Explicit account/isolation requirement; Sites-hosted resources would not establish it. |
| D003 | One Worker, static assets, plain JavaScript, one D1 | Minimal auditable system without frontend frameworks. |
| D004 | Five-minute heartbeat, seven-day operational retention | Low usage and visible scheduling. Heartbeat is not a market scan. |
| D005 | Public read-only foundation status; no HTTP writes | No public job execution; add authentication before private account/trade data. |
| D006 | Paper-only, trading disabled, live scan/no trade | Fail closed; $5,000 is planned capital, never a claimed balance. |
| D007 | Logs allowlisted, exception text excluded | Prevent credentials or source payloads leaking through errors. |

| D008 | Retain 100% of foundation invocation logs | Database outages can prevent persisted error records; sampling could otherwise hide the only failure evidence. Small M0 traffic stays inexpensive. Revisit with measured usage before market ingestion. |
| D009 | Separate Worker entrypoint and helper module; use stable Miniflare for tests | Actual runtime checks caught unsupported named constant exports. Entrypoint now exports only the handler; tests execute the real entrypoint with real D1. |
