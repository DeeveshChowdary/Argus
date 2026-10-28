You are building an autonomous U.S. stock-scanning and paper-trading system in this repository.

Your job is to design, implement, test, deploy, and maintain the project incrementally without losing track of state.

The system must eventually:

- scan U.S. equities, including penny stocks
- detect unusual movers, abnormal volume, gaps, volatility, and after-hours activity
- ingest multiple information streams:
  - SEC filings
  - company press releases
  - financial/news feeds
  - Reddit/social signals
  - later, other useful free or low-cost sources
- track social mention velocity, comment velocity, sentiment changes, and after-hours chatter
- normalize and deduplicate events
- rank opportunities
- use an LLM only on filtered, high-value event bundles
- support a second LLM for ambiguous or high-impact cases if useful
- send approved trades to Alpaca paper trading
- track every signal, trade, outcome, and rejected trade
- continuously measure which strategies/signals work best
- adapt rankings/weights based on observed paper-trading results
- provide a dashboard showing scanner health, candidates, signals, trades, strategy performance, and system errors

The initial paper portfolio is $5,000.

The goal during paper mode is to maximize learning and discover genuine edge, not to optimize for low volatility. However, the system must still have hard risk controls so one bug or one bad strategy cannot destroy the whole portfolio.

Use the user's existing Cloudflare account and create new isolated resources for this project. Do not modify or interfere with unrelated existing Cloudflare projects/resources.

Preferred infrastructure:

- GitHub: source control
- Cloudflare Workers: scanner/orchestration/backend
- Cloudflare Cron Triggers: scheduled scans
- Cloudflare D1: persistent database
- Cloudflare Pages or Workers-hosted frontend: dashboard
- Alpaca: market data + paper trading
- LLM API: added only after the non-LLM pipeline is proven

Prioritize free-tier usage. Do not introduce paid infrastructure unless absolutely necessary. If a paid service appears necessary, document why before using it.

IMPORTANT DEVELOPMENT RULES

1. Do not attempt to build the entire project at once.
2. Work milestone by milestone.
3. Maintain project state in the repository.
4. Before starting any new task, read the current state files.
5. After every meaningful implementation step:
   - test it
   - record what changed
   - record what remains
   - record blockers
   - update current state
6. Do not mark a task complete just because code exists. It must pass its acceptance criteria.
7. Keep the repository deployable after each milestone whenever possible.
8. Do not add unnecessary frameworks or complexity.
9. Prefer simple, auditable systems over clever abstractions.
10. Never place live-money trades. Paper trading only.
11. Never expose API secrets in source files, logs, commits, or frontend code.
12. Use Cloudflare secrets/environment variables for credentials.
13. Do not commit `.env` files or secrets.
14. Avoid destructive changes to existing Cloudflare resources.
15. When uncertain between two implementations, choose the simpler one and document the decision.

CREATE THESE PROJECT FILES FIRST

Create and maintain:

- `docs/ARCHITECTURE.md`
- `docs/EXECUTION_PLAN.md`
- `docs/CURRENT_STATE.md`
- `docs/DECISIONS.md`
- `docs/DATA_SOURCES.md`
- `docs/TEST_MATRIX.md`
- `docs/STRATEGIES.md`

`CURRENT_STATE.md` must always include:

- current milestone
- current task
- completed work
- work in progress
- blockers
- known bugs
- tests passing
- tests failing
- last deployment status
- next exact task

Do not let this file become stale.

SYSTEM ARCHITECTURE

Target architecture:

U.S. STOCK UNIVERSE
    ↓
MARKET ACTIVITY SCANNER
    ↓
RANKED CANDIDATES
    ↓
NEWS / SEC / PRESS RELEASES / SOCIAL
    ↓
NORMALIZATION
    ↓
DEDUPLICATION
    ↓
FEATURE / SIGNAL GENERATION
    ↓
OPPORTUNITY RANKING
    ↓
LLM ANALYSIS FOR SELECTED EVENTS
    ↓
RISK ENGINE
    ↓
ALPACA PAPER EXECUTION
    ↓
RESULT TRACKING
    ↓
STRATEGY PERFORMANCE / LEARNING
    ↓
DASHBOARD

IMPORTANT: the LLM must never directly control the broker.

The LLM may produce structured analysis, but deterministic code must decide whether a trade is permitted.

MILESTONE 0 — PROJECT FOUNDATION

Build:

- Cloudflare project configuration
- Worker deployment
- D1 database
- database migrations
- environment/secrets structure
- health endpoint
- logging
- basic error handling
- scheduled invocation test
- basic frontend/dashboard shell

Acceptance criteria:

- Worker deploys successfully
- health endpoint responds
- D1 read/write works
- cron/scheduled task executes successfully
- no secrets are exposed
- dashboard loads
- deployment instructions are documented

Do not proceed until these pass.

MILESTONE 1 — STOCK UNIVERSE + MARKET SCANNER

Integrate Alpaca market data.

Build:

- Alpaca API connectivity
- retrieve U.S. tradable equities
- store/update symbol universe
- identify active tradable stocks
- include penny stocks
- calculate basic market-activity features:
  - percent move
  - gap
  - volume
  - relative volume if data permits
  - volatility
  - after-hours / premarket movement where available
- produce a ranked candidate list
- store candidate snapshots in D1

The scanner should not stream thousands of stocks simultaneously.

Scan broadly using the cheapest available endpoint/polling approach, then narrow to a smaller hot list for deeper tracking.

Acceptance criteria:

- live U.S. symbol universe is retrieved
- scanner produces a ranked live candidate list
- after-hours candidates can be detected when applicable
- results persist in D1
- dashboard displays candidates
- scanner automatically runs on schedule
- failures are visible in logs/system health

Do not proceed until these pass.

MILESTONE 2 — SEC + CATALYST PIPELINE

Add:

- SEC filings
- relevant filing types
- company filings mapped to tickers
- press releases if a reliable free source is available
- free/cheap financial news source(s)

Normalize every incoming event into one internal event schema.

Event schema should include at least:

- source
- source type
- ticker(s)
- headline/title
- body/summary
- timestamp
- source URL/reference
- ingestion timestamp
- event type
- dedupe key
- raw source metadata

Implement deduplication so the same event reported by multiple sources does not count as multiple independent catalysts.

Acceptance criteria:

- live SEC filings arrive
- at least one news/catalyst source works
- events are normalized
- duplicates are grouped
- candidate detail view shows catalyst timeline

MILESTONE 3 — REDDIT / SOCIAL SIGNALS

Add Reddit first.

Use authorized API access where required.

Track:

- ticker mentions
- mention velocity
- comment velocity
- post age
- engagement
- sentiment
- sentiment change vs baseline
- unusual after-hours activity
- subreddit/source context
- spam/duplicate filtering

Do not treat raw mention count as a bullish signal.

Prefer relative metrics such as:

current mention rate / normal mention rate

and:

current sentiment - historical baseline sentiment

Store social observations historically so baselines can be calculated.

Acceptance criteria:

- recent Reddit activity can be associated with tickers
- mention acceleration is calculated
- social data is timestamped and persisted
- after-hours social activity is distinguishable
- dashboard shows social acceleration for candidates

MILESTONE 4 — OPPORTUNITY RANKING

Create a deterministic ranking engine before adding an LLM.

Combine:

- abnormal price movement
- relative volume
- volatility
- catalyst strength
- catalyst novelty
- source reliability
- social mention acceleration
- sentiment acceleration
- after-hours activity
- liquidity
- spread/execution risk
- market cap / float if available
- recent dilution risk if available
- historical signal performance once data exists

Produce:

- opportunity score
- component scores
- human-readable reason for ranking

Every ranking must be explainable.

Acceptance criteria:

- candidates are ranked
- component scores are stored
- dashboard shows why each stock ranks where it does
- rankings are reproducible from stored data

MILESTONE 5 — LLM ANALYSIS

Only now add the LLM.

Do not send raw firehose data to the LLM.

First filter, normalize, deduplicate, and rank.

Only high-value/ambiguous events should be sent.

LLM input should contain a compact event bundle:

- ticker
- recent price action
- volume context
- after-hours context
- catalyst(s)
- social metrics
- relevant recent filings/news
- existing system score
- important risks

LLM must return structured output such as:

- direction:
  - bullish
  - bearish
  - neutral
- confidence
- catalyst category
- estimated horizon
- thesis
- key evidence
- contradictory evidence
- major risks
- whether second opinion is needed
- whether signal should be ignored

Do not let the LLM execute trades.

Default runtime should favor the cheaper useful model.

Allow a second model only when:

- first model is uncertain
- catalyst is high impact
- evidence conflicts
- trade size would be unusually large
- event is novel/unusual

Track:

- model used
- prompt version
- input event IDs
- output
- cost if available
- latency
- final system decision

Acceptance criteria:

- LLM analysis is structured
- malformed output is handled safely
- every model decision can be traced to exact source events
- second-model escalation works when enabled
- LLM failures never result in automatic trades

MILESTONE 6 — PAPER TRADING + RISK ENGINE

Connect Alpaca paper trading only.

Implement deterministic risk controls.

At minimum:

- maximum position size
- maximum concurrent positions
- liquidity threshold
- spread threshold
- stale-signal rejection
- duplicate-position prevention
- daily loss guardrail
- portfolio drawdown guardrail
- penny-stock specific execution checks
- kill switch
- API failure handling
- rejected-trade logging

The system may be aggressive in paper mode, because the objective is learning, but it must not behave randomly.

Support a small exploration budget for lower-confidence experimental strategies.

Every order must link to:

- candidate
- source events
- ranking snapshot
- LLM analysis if used
- strategy
- risk decision
- execution result

Acceptance criteria:

- system can place Alpaca paper orders automatically
- every trade has full provenance
- rejected trades show explicit reasons
- kill switch works
- no live trading credentials/endpoints are used

MILESTONE 7 — OUTCOME TRACKING / LEARNING ENGINE

Track every signal, even if no trade was taken.

Measure forward performance at useful horizons such as:

- 5m
- 15m
- 30m
- 1h
- 4h
- market close
- 1d
- 3d
- 5d

Track:

- max favorable excursion
- max adverse excursion
- realized P&L
- unrealized P&L
- entry slippage estimate
- strategy
- signal family
- catalyst type
- social conditions
- market regime
- LLM confidence
- system score

Create strategy-level performance summaries.

Do not let the LLM “learn” merely by changing its own prompt based on anecdotal success.

Learning should come from measured results.

Start with controlled weight adjustment / strategy re-ranking based on observed evidence.

Acceptance criteria:

- system can answer which strategies perform best
- system can compare traded vs rejected signals
- system can compare different catalyst types
- system can measure whether LLM confidence correlates with outcomes
- system can update ranking weights in a controlled, reversible way
- all changes to ranking logic are versioned

MILESTONE 8 — DASHBOARD / OPERATIONS

Dashboard should show:

SYSTEM HEALTH
- scanner status
- last successful market scan
- last SEC scan
- last Reddit scan
- last LLM call
- API failures
- database status

MARKET
- top candidates
- current movers
- after-hours movers
- unusual-volume names

INTELLIGENCE
- recent catalysts
- social acceleration
- opportunity scores
- LLM analysis

TRADING
- open positions
- closed trades
- realized/unrealized P&L
- rejected trades
- reason for each trade

LEARNING
- strategy leaderboard
- performance by catalyst
- performance by confidence
- performance by holding horizon
- win/loss distribution
- drawdown
- recent changes to model/ranking weights

OPERATING MODE

Initially:

PAPER ONLY

No real-money endpoint should be enabled.

FREE-TIER PRIORITY

Prefer free sources and free infrastructure.

When a data source has limitations:

- document the limit
- design around it
- do not silently substitute low-quality data
- mark missing data explicitly

Avoid paying for broad premium data feeds until paper results justify the expense.

DATA QUALITY RULES

For every external source:

- record source
- timestamp
- ingestion time
- freshness
- reliability
- API errors
- stale state

If an important source is down or stale, the system should reduce confidence or stop trading rather than silently proceed as though data is complete.

AFTER-HOURS IMPORTANCE

Treat premarket and after-hours as first-class modes.

The system should explicitly know which market session it is in.

After-hours scanning should emphasize:

- earnings
- guidance
- SEC filings
- press releases
- sudden social acceleration
- abnormal extended-hours price/volume activity

PENNY STOCKS

Include them, but apply stricter execution-quality checks.

Pay special attention to:

- low liquidity
- huge spreads
- dilution
- reverse splits
- low float
- promotional/social manipulation
- halts
- unreliable paper fills

Do not exclude them automatically, but do not allow unrealistic paper fills to create fake strategy performance.

TESTING MODES

Support:

1. live scan / no trade
2. live paper trading
3. historical replay where practical
4. dry-run order mode

No milestone should depend exclusively on manual testing.

FINAL WORKFLOW FOR EVERY TASK

Before coding:

1. read `docs/CURRENT_STATE.md`
2. read relevant architecture/decision docs
3. identify one concrete next task

Then:

1. implement
2. test
3. fix
4. deploy if appropriate
5. validate deployed behavior
6. update docs
7. update `CURRENT_STATE.md`
8. commit working state

Never start unrelated features while the current acceptance criteria are failing.

FIRST TASK

Start with Milestone 0 only.

Inspect the repository and the user's existing Cloudflare context.

Create isolated Cloudflare resources for this project.

Do not modify unrelated existing Cloudflare resources.

Set up the project foundation, documentation/state tracking, Worker, D1, scheduled task, and basic dashboard shell.

Stop after Milestone 0 is working and its acceptance criteria pass.

Then report:

- what you created
- Cloudflare resources created
- tests run
- deployment URL(s)
- any credentials/secrets the user still needs to add
- blockers
- exact next milestone
- exact contents/status of `docs/CURRENT_STATE.md`

Do not begin Milestone 1 until Milestone 0 is verified.