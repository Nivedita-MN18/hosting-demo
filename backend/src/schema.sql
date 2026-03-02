-- TraceLite schema — run once on first boot (server.js calls this via db.js)

CREATE TABLE IF NOT EXISTS traces (
  id          SERIAL       PRIMARY KEY,
  trace_id    UUID         NOT NULL,
  service     VARCHAR(128) NOT NULL,
  span        VARCHAR(256) NOT NULL,
  duration_ms INT          NOT NULL  CHECK (duration_ms >= 0),
  status      VARCHAR(10)  NOT NULL  CHECK (status IN ('OK', 'ERROR', 'SLOW')),
  timestamp   BIGINT       NOT NULL  -- Unix seconds from client clock
);

-- Idempotency: duplicate (traceId + service + span + timestamp) is silently ignored
CREATE UNIQUE INDEX IF NOT EXISTS ux_traces_dedup
  ON traces (trace_id, service, span, timestamp);

-- Query patterns: look up by traceId, filter by service, range-scan by time
CREATE INDEX IF NOT EXISTS ix_traces_trace_id  ON traces (trace_id);
CREATE INDEX IF NOT EXISTS ix_traces_service   ON traces (service);
CREATE INDEX IF NOT EXISTS ix_traces_timestamp ON traces (timestamp DESC);
