-- Only applied to the dedicated Argus D1 database.
CREATE TABLE schema_metadata (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO schema_metadata (version) VALUES (1);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL CHECK (job = 'foundation_heartbeat'),
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  error_code TEXT CHECK (error_code IS NULL OR error_code = 'HEARTBEAT_FAILED')
);
CREATE INDEX job_runs_scheduled ON job_runs (scheduled_at DESC);
CREATE INDEX job_runs_success ON job_runs (status, scheduled_at DESC);

CREATE TABLE system_errors (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  component TEXT NOT NULL CHECK (component = 'scheduler'),
  code TEXT NOT NULL CHECK (code = 'HEARTBEAT_FAILED'),
  run_id TEXT NOT NULL
);
CREATE INDEX system_errors_occurred ON system_errors (occurred_at DESC);
