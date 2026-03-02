# ⚡ TraceLite — Lightweight Distributed Request Tracing

TraceLite lets you trace a single HTTP request across multiple services using a shared `traceId`, then visualise where time was spent in a browser-based waterfall dashboard.

```
Client → order-service → payment-service → inventory-service
                              ↓
                        TraceLite API (PostgreSQL)
                              ↓
                        Web Dashboard (Waterfall Timeline)
```

---

## How It Works

1. **Every incoming request gets a `traceId`** (UUID). The middleware reads `X-Trace-Id` from the request header or mints a new one.
2. **Each service emits a span** (fire-and-forget POST) to the TraceLite API on request completion.
3. **The backend stores spans** in PostgreSQL, indexed for fast lookup by `traceId`.
4. **The frontend reconstructs the waterfall** — a timeline showing which service took how long, with the slowest span highlighted as the bottleneck.

---

## Quick Start (Docker)

```bash
# 1. Clone and start backend + DB
cd demo-hosting
cp backend/.env.example backend/.env
docker-compose up -d

# 2. Seed demo data (no real services needed)
cd demo
npm install
node seed.js
# → prints a traceId

# 3. Open the frontend
open frontend/index.html
# Paste the traceId → Search → View Trace
```

---

## Middleware Integration

Add one line to any Express service:

```js
const { traceMiddleware } = require("tracelite-middleware");

// Set these env vars in your service:
// TRACELITE_API_URL=http://localhost:3001
// TRACELITE_API_KEY=dev-secret-key

app.use(traceMiddleware("my-service-name"));
```

That's it. The middleware:
- Reads `X-Trace-Id` from incoming requests (or generates one)
- Sets `X-Trace-Id` on the response
- **Automatically propagates** `X-Trace-Id` to all downstream `http`/`https` calls (via `AsyncLocalStorage` + module-level patch — no code changes required)
- Posts a span to TraceLite on request completion
- Classifies status: `SLOW` (>500ms), `ERROR` (5xx), `OK` otherwise

```js
// Threshold is configurable
process.env.TRACELITE_SLOW_THRESHOLD_MS = "200"; // default: 500
```

---

## Running the Demo Services

The `demo/` directory contains 3 Express services that call each other in a chain.
Service B has an intentional 820ms delay to simulate a slow database call.

```bash
cd demo
npm install

# Terminal 1
npm run start:a   # order-service    → localhost:4001/order

# Terminal 2
npm run start:b   # payment-service  → localhost:4002/payment (⚠️ slow!)

# Terminal 3
npm run start:c   # inventory-service → localhost:4003/inventory

# Make a traced request
curl http://localhost:4001/order
# Note the traceId in the response, paste it into the dashboard
```

Or run all three at once:
```bash
npm run demo
```

---

## REST API Reference

All endpoints require an API key:
```
X-Api-Key: dev-secret-key
# or
Authorization: Bearer dev-secret-key
```

### `POST /api/v1/traces` — Ingest a span

```json
{
  "traceId":    "550e8400-e29b-41d4-a716-446655440000",
  "service":    "payment-service",
  "span":       "db-query",
  "durationMs": 820,
  "status":     "SLOW",
  "timestamp":  1710000000
}
```

Idempotent — posting the same span twice returns `200` (not `201`) with `"inserted": false`.

### `GET /api/v1/traces/:traceId` — Get a full trace

Returns all spans sorted by timestamp, plus a pre-computed summary:
```json
{
  "traceId": "...",
  "spanCount": 4,
  "totalDurationMs": 1630,
  "slowestSpan": { "service": "payment-service", "span": "db-query", "durationMs": 820 },
  "services": ["order-service", "payment-service", "inventory-service"],
  "spans": [ ... ]
}
```

### `GET /api/v1/traces` — List/filter traces

Query params: `service`, `status` (OK|SLOW|ERROR), `from` (unix ts), `to` (unix ts), `limit` (default 50, max 200)

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `TRACELITE_API_KEY` | — | Static API key (leave unset to disable auth) |
| `PORT` | `3001` | HTTP port |
| `NODE_ENV` | `development` | Set to `production` to hide stack traces |

### Middleware (service env)

| Variable | Default | Description |
|---|---|---|
| `TRACELITE_API_URL` | `http://localhost:3001` | TraceLite backend URL |
| `TRACELITE_API_KEY` | — | Must match backend key |
| `TRACELITE_SLOW_THRESHOLD_MS` | `500` | SLOW classification threshold |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (static HTML/JS)                          │
│  frontend/index.html  — Trace Search                │
│  frontend/trace.html  — Waterfall Timeline          │
└─────────────────┬───────────────────────────────────┘
                  │ fetch()
┌─────────────────▼───────────────────────────────────┐
│  TraceLite REST API  (Express.js, stateless)        │
│  POST /api/v1/traces     ← span ingestion           │
│  GET  /api/v1/traces/:id ← trace query              │
│  GET  /api/v1/traces     ← list/filter              │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│  PostgreSQL                                         │
│  Table: traces                                      │
│  Indexes: trace_id, service, timestamp              │
└─────────────────────────────────────────────────────┘
```

### Design decisions

- **Static API key** over JWT: services need a long-lived credential to post spans; JWT refresh loops add no security benefit for a platform key.
- **Idempotent writes** via composite unique index: no extra SELECT needed; ON CONFLICT DO NOTHING is atomic.
- **AsyncLocalStorage** for propagation: cleaner than thread-locals or explicit context passing; patching `http.request` at module level means application code needs zero changes.
- **Fire-and-forget spans**: tracing MUST NOT affect service availability. If TraceLite is down, the service keeps running.
- **No build step in frontend**: plain HTML/JS is CDN-friendly, debuggable in browser devtools, zero CI dependency.

---

## Running Tests

```bash
# Start backend first (docker-compose up -d)
cd backend
npm install
npm test
```

Tests cover: auth, validation, idempotency, timestamp sort order, filtering, 404.

---

## Project Structure

```
demo-hosting/
├── backend/           # TraceLite REST API
│   ├── src/
│   │   ├── app.js          # Express app
│   │   ├── server.js       # Entry point + migration runner
│   │   ├── db.js           # PostgreSQL pool
│   │   ├── schema.sql      # Table + index definitions
│   │   ├── routes/
│   │   │   └── traces.js   # Ingestion + query handlers
│   │   └── middleware/
│   │       ├── auth.js     # API key auth
│   │       └── rateLimit.js
│   ├── test/
│   │   └── integration.js  # Integration tests (no framework)
│   ├── Dockerfile
│   └── package.json
├── middleware/        # tracelite-middleware SDK
│   └── index.js      # One-line Express middleware
├── demo/              # Demo microservices
│   ├── service-a/index.js  # order-service → calls B
│   ├── service-b/index.js  # payment-service → slow DB sim → calls C
│   ├── service-c/index.js  # inventory-service → fast
│   └── seed.js             # Posts demo spans, prints traceId
├── frontend/          # Static web dashboard
│   ├── config.js           # API URL + key (only file to update for prod)
│   ├── index.html          # Trace Search page
│   └── trace.html          # Waterfall Timeline page
└── docker-compose.yml # postgres + api
```
