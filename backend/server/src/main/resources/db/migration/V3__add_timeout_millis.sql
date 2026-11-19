-- Execution deadline: if > 0, the run is auto-cancelled after this many wall-clock milliseconds.
ALTER TABLE simulation_runs ADD COLUMN timeout_millis BIGINT NOT NULL DEFAULT 0;
