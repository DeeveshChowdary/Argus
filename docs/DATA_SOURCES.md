# Data sources

No market/news/social/LLM/broker source is enabled in Milestone 0. Only actual foundation health is displayed. Say “not connected”; never synthesize candidates, fills or performance.

| Source | Milestone | Verify before integrating |
| --- | --- | --- |
| Alpaca assets/market data | 1 | Paper credentials, actual feed entitlement, quotas, freshness, coverage and extended-hours availability. Broad cheap polling then small hot list. |
| SEC EDGAR | 2 | Official feed/API, contact User-Agent, fair-access limits, CIK/ticker mapping; retain filing/accession timestamps. |
| Releases/financial news | 2 | At least one authorized reliable free source; document licensing, coverage, delay and quotas. |
| Reddit | 3 | Authorized API access, limits, subreddit context, spam/ticker ambiguity and historical baselines. |
| LLM | 5 | Filtered compact bundles, structured output, server secrets, provenance, cost budget, optional second opinion. |
| Alpaca paper broker | 6 | Paper endpoint only; live endpoint never configurable. Asset order eligibility and realistic penny-stock execution. |

Every future observation records source, source time, ingestion time, freshness, reliability, API errors and stale state. Missing fields remain explicit nulls with reason. Never silently substitute lower-quality data. No premium feeds or paid infrastructure introduced.
