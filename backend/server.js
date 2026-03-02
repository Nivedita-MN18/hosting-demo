// TraceLite Backend - Express REST API
// Stateless ingestion and query APIs for distributed tracing spans.

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

// --- Configuration ---

const app = express();
const PORT = process.env.PORT || 4000;

// Basic API key auth; keep backend stateless
const API_KEY = process.env.TRACELITE_API_KEY || '';

// Postgres connection (pool is safe for high throughput & async usage)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
});

// --- Middleware ---

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
  })
);
app.use(express.json({ limit: '256kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Simple API key auth middleware
function authMiddleware(req, res, next) {
  if (!API_KEY) return next(); // If not configured, run open (for local/demo)
  const headerKey = req.header('x-api-key');
  if (headerKey && headerKey === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Basic rate limiter for ingestion to protect backend
const ingestLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.INGEST_RATE_LIMIT || '600', 10),
  standardHeaders: true,
  legacyHeaders: false,
});

// Health endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', detail: 'db_unreachable' });
  }
});

// --- Helpers ---

function validateIngestBody(body) {
  const errors = [];
  const result = {};

  if (!body.traceId || typeof body.traceId !== 'string') {
    errors.push('traceId is required and must be a string');
  } else {
    result.trace_id = body.traceId;
  }

  if (!body.service || typeof body.service !== 'string') {
    errors.push('service is required and must be a string');
  } else {
    result.service = body.service;
  }

  if (!body.span || typeof body.span !== 'string') {
    errors.push('span is required and must be a string');
  } else {
    result.span = body.span;
  }

  const duration = Number(body.durationMs);
  if (!Number.isFinite(duration) || duration < 0) {
    errors.push('durationMs must be a non-negative number');
  } else {
    result.duration_ms = duration;
  }

  const allowedStatus = ['OK', 'ERROR', 'SLOW'];
  if (!body.status || !allowedStatus.includes(body.status)) {
    errors.push(`status must be one of ${allowedStatus.join(', ')}`);
  } else {
    result.status = body.status;
  }

  const ts = Number(body.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    errors.push('timestamp must be a positive unix epoch seconds');
  } else {
    // store as bigint seconds; could be converted to timestamptz in SQL
    result.timestamp = ts;
  }

  return { errors, value: result };
}

// --- Routes ---

// Trace ingestion - idempotent via unique index on (trace_id, service, span, timestamp)
app.post(
  '/api/v1/traces',
  authMiddleware,
  ingestLimiter,
  async (req, res) => {
    const { errors, value } = validateIngestBody(req.body || {});
    if (errors.length) {
      return res.status(400).json({ errors });
    }

    const insertQuery = `
      INSERT INTO traces (trace_id, service, span, duration_ms, status, timestamp)
      VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
      ON CONFLICT (trace_id, service, span, timestamp) DO NOTHING
      RETURNING id
    `;

    try {
      const params = [
        value.trace_id,
        value.service,
        value.span,
        value.duration_ms,
        value.status,
        value.timestamp,
      ];

      const result = await pool.query(insertQuery, params);

      // Idempotent: if row existed, no error; we indicate if created
      const created = result.rowCount === 1;
      return res.status(created ? 201 : 200).json({
        created,
      });
    } catch (err) {
      console.error('Failed to ingest trace span', err);
      return res.status(500).json({ error: 'internal_error' });
    }
  }
);

// Get all spans for a given traceId, sorted for timeline rendering
app.get('/api/v1/traces/:traceId', authMiddleware, async (req, res) => {
  const traceId = req.params.traceId;
  if (!traceId) {
    return res.status(400).json({ error: 'traceId is required' });
  }

  const query = `
    SELECT trace_id AS "traceId",
           service,
           span,
           duration_ms AS "durationMs",
           status,
           EXTRACT(EPOCH FROM timestamp)::bigint AS "timestamp"
    FROM traces
    WHERE trace_id = $1
    ORDER BY timestamp ASC, service ASC, span ASC
  `;

  try {
    const result = await pool.query(query, [traceId]);
    return res.json({ traceId, spans: result.rows });
  } catch (err) {
    console.error('Failed to fetch trace', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Query spans by filters for search UI
app.get('/api/v1/traces', authMiddleware, async (req, res) => {
  const { service, status, from, to, limit } = req.query;

  const where = [];
  const params = [];

  if (service) {
    params.push(service);
    where.push(`service = $${params.length}`);
  }

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  if (from) {
    const fromNum = Number(from);
    if (!Number.isFinite(fromNum)) {
      return res.status(400).json({ error: 'from must be a unix epoch seconds' });
    }
    params.push(fromNum);
    where.push(`timestamp >= to_timestamp($${params.length})`);
  }

  if (to) {
    const toNum = Number(to);
    if (!Number.isFinite(toNum)) {
      return res.status(400).json({ error: 'to must be a unix epoch seconds' });
    }
    params.push(toNum);
    where.push(`timestamp <= to_timestamp($${params.length})`);
  }

  const safeLimit = Math.min(
    Number.isFinite(Number(limit)) ? Number(limit) : 200,
    1000
  );

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const query = `
    SELECT trace_id AS "traceId",
           service,
           span,
           duration_ms AS "durationMs",
           status,
           EXTRACT(EPOCH FROM timestamp)::bigint AS "timestamp"
    FROM traces
    ${whereSql}
    ORDER BY timestamp DESC
    LIMIT ${safeLimit}
  `;

  try {
    const result = await pool.query(query, params);
    return res.json({ spans: result.rows });
  } catch (err) {
    console.error('Failed to search traces', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// --- Startup ---

app.listen(PORT, () => {
  console.log(`TraceLite backend listening on port ${PORT}`);
});

