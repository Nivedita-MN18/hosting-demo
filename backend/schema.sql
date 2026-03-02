-- TraceLite PostgreSQL schema
-- Minimal, indexed, and optimized for trace timeline queries.

CREATE TABLE IF NOT EXISTS traces (
  id SERIAL PRIMARY KEY,
  trace_id VARCHAR(128) NOT NULL,
  service VARCHAR(128) NOT NULL,
  span VARCHAR(255) NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  status VARCHAR(16) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL
);

-- Ensure idempotent ingestion for same span
CREATE UNIQUE INDEX IF NOT EXISTS traces_unique_span_idx
  ON traces (trace_id, service, span, timestamp);

CREATE INDEX IF NOT EXISTS traces_trace_id_idx
  ON traces (trace_id);

CREATE INDEX IF NOT EXISTS traces_service_idx
  ON traces (service);

CREATE INDEX IF NOT EXISTS traces_timestamp_idx
  ON traces (timestamp);

