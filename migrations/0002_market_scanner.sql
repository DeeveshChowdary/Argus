-- Additive Milestone 1 schema. Foundation history is preserved.
INSERT INTO schema_metadata (version) VALUES (2);

CREATE TABLE universe_versions (
  id TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'alpaca_paper_assets',
  status TEXT NOT NULL CHECK (status IN ('building', 'ready')),
  asset_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE universe_assets (
  universe_id TEXT NOT NULL REFERENCES universe_versions(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  exchange TEXT NOT NULL,
  fractionable INTEGER NOT NULL CHECK (fractionable IN (0, 1)),
  shortable INTEGER NOT NULL CHECK (shortable IN (0, 1)),
  attributes_json TEXT NOT NULL CHECK (json_valid(attributes_json)),
  PRIMARY KEY (universe_id, symbol)
);

CREATE TABLE scanner_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  universe_id TEXT REFERENCES universe_versions(id),
  cursor INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  hotlist_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(hotlist_json))
);
INSERT INTO scanner_state (id) VALUES (1);

CREATE TABLE market_scans (
  id TEXT PRIMARY KEY,
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'skipped')),
  error_code TEXT,
  feed TEXT NOT NULL DEFAULT 'iex' CHECK (feed = 'iex'),
  session TEXT,
  source_asof TEXT,
  universe_id TEXT,
  universe_count INTEGER NOT NULL DEFAULT 0,
  broad_requested INTEGER NOT NULL DEFAULT 0,
  hot_requested INTEGER NOT NULL DEFAULT 0,
  returned_count INTEGER NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL DEFAULT 0,
  next_cursor INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  candidates_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(candidates_json)),
  quality_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(quality_json))
);
CREATE INDEX market_scans_scheduled ON market_scans (scheduled_at DESC);
CREATE INDEX market_scans_success ON market_scans (status, scheduled_at DESC);
