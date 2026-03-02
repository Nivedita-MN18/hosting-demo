## TraceLite – Lightweight Distributed Request Tracing

TraceLite is a minimal, production-grade tracing system that lets you follow a single request across multiple services using a shared `traceId`, and see exactly **where the time went**.

### Components

- **Backend API (`backend`)**: Stateless Express REST API with PostgreSQL storage.
- **Frontend Dashboard (`frontend`)**: React single-page app, built with Vite and deployable as static assets.
- **Node.js Middleware SDK (`sdk`)**: `traceMiddleware(serviceName)` for Express.
- **Demo Services (`demo-services`)**: Three small services (A → B → C) that generate a full trace with a deliberate bottleneck.

### Data Model

Table `traces`:

- **id**: primary key
- **trace_id**: logical trace identifier shared across services
- **service**: service name (e.g. `service-a`)
- **span**: span name (e.g. `GET /demo`, `db-query`)
- **duration_ms**: duration in milliseconds
- **status**: `OK | ERROR | SLOW`
- **timestamp**: span start time (PostgreSQL `timestamptz`)

Indexes:

- `trace_id` (for reconstructing a single trace timeline)
- `service` (for service-based filtering)
- `timestamp` (for time-range queries)
- unique `(trace_id, service, span, timestamp)` for idempotent ingestion

### Backend: REST API

Directory: `backend`

- **Tech**: Node.js, Express, `pg`, stateless design.
- **Config via env** (`DATABASE_URL`, `TRACELITE_API_KEY`, etc.).
- **Auth**: simple API key via `x-api-key` header.
- **Rate limiting**: applied to ingestion.

#### Endpoints

- **POST `/api/v1/traces`**
  - Body:

    ```json
    {
      "traceId": "uuid-or-any-string",
      "service": "payment-service",
      "span": "db-query",
      "durationMs": 820,
      "status": "OK",
      "timestamp": 1710000000
    }
    ```

  - Behavior:
    - Validates all fields.
    - Writes to PostgreSQL using `INSERT ... ON CONFLICT DO NOTHING` for idempotency.
    - Safe for high-throughput, async-friendly via `pg` pool.

- **GET `/api/v1/traces/{traceId}`**
  - Returns all spans for the trace:

    ```json
    {
      "traceId": "abc123",
      "spans": [
        {
          "traceId": "abc123",
          "service": "service-a",
          "span": "GET /demo",
          "durationMs": 32,
          "status": "OK",
          "timestamp": 1710000000
        }
      ]
    }
    ```

  - Sorted by `timestamp` for timeline reconstruction.

- **GET `/api/v1/traces?service=&status=&from=&to=`**
  - Query spans by service, status, and optional time range.
  - Optimized for building search/filter UI in the dashboard.

### PostgreSQL Setup

Run the schema:

```bash
psql "$DATABASE_URL" -f backend/schema.sql
```

Minimal local setup example:

```bash
createdb tracelite
psql tracelite -c "create user tracelite with password 'tracelite';"
psql tracelite -c "grant all privileges on database tracelite to tracelite;"
psql tracelite -f backend/schema.sql
```

### Node.js Middleware SDK

Directory: `sdk`

Express integration:

```js
const express = require('express');
const { traceMiddleware } = require('./sdk/traceMiddleware');

const app = express();

app.use(
  traceMiddleware('order-service', {
    backendUrl: 'http://localhost:4000',
    apiKey: process.env.TRACELITE_API_KEY,
  })
);
```

What it does:

- **Generate `traceId` if missing**.
- **Read/write `X-Trace-Id` header** on incoming and outgoing HTTP calls.
- **Attach to request context**: `req.traceId` and `req.context.traceId`.
- **Propagate to downstream HTTP calls** via `req.traceHttpClient.httpRequest/httpsRequest`.
- **Emit spans automatically** to TraceLite backend for every request:
  - span name: `METHOD path` (e.g. `GET /order/123`)
  - duration: measured from request start to response finish
  - status: mapped from HTTP status code (`OK | SLOW | ERROR`)
  - timestamp: Unix seconds at span start.

### Frontend Dashboard

Directory: `frontend`

- **Tech**: React + Vite, shipped as static assets (CDN-friendly).
- **Config**: `VITE_API_BASE` (default `http://localhost:4000`).

Pages / views:

- **Trace Search**
  - Search by `traceId` or filter by `service` / `status`.
  - Shows per-trace summary: total duration, span count, involved services.
  - Clicking a trace loads the detail view.

- **Trace Detail**
  - Waterfall-style **timeline**:
    - Horizontal bars per span, offset by start time relative to trace start.
    - Color highlights slow/error spans.
  - **Per-service latency summary**:
    - Total time per service.
    - Bottleneck service clearly highlighted (largest total duration).
  - Answers: **“Where did the time go?”** at a glance.

Run locally:

```bash
cd frontend
npm install
npm run dev
```

Then open the printed URL (default `http://localhost:5173`).

### Demo Services

Directory: `demo-services`

- **Service A (`service-a.js`)**
  - Entry point: `GET /demo`.
  - Uses middleware `traceMiddleware('service-a', ...)`.
  - Calls Service B `/work`, then Service C `/slow-db` using propagated `X-Trace-Id`.

- **Service B (`service-b.js`)**
  - `GET /work` performs a small CPU-bound task (~50ms).

- **Service C (`service-c.js`)**
  - `GET /slow-db` simulates a slow DB call (~800ms).
  - This is the **bottleneck** you should see in the UI.

Run locally:

```bash
cd demo-services
npm install
TRACELITE_BACKEND_URL=http://localhost:4000 node service-a.js
TRACELITE_BACKEND_URL=http://localhost:4000 node service-b.js
TRACELITE_BACKEND_URL=http://localhost:4000 node service-c.js
```

### Running the Full Demo

1. **Start PostgreSQL** and apply `backend/schema.sql`.
2. **Start the backend**:

   ```bash
   cd backend
   npm install
   export DATABASE_URL=postgres://tracelite:tracelite@localhost:5432/tracelite
   export TRACELITE_API_KEY=demo-key
   npm run dev
   ```

3. **Start demo services** (in separate terminals):

   ```bash
   cd demo-services
   export TRACELITE_BACKEND_URL=http://localhost:4000
   export TRACELITE_API_KEY=demo-key
   node service-b.js
   node service-c.js
   node service-a.js
   ```

4. **Trigger a demo trace**:

   ```bash
   curl http://localhost:5001/demo
   ```

   - Response includes the `traceId`.
   - The same `traceId` is also logged by each service.

5. **Start the frontend**:

   ```bash
   cd frontend
   npm install
   VITE_API_BASE=http://localhost:4000 npm run dev
   ```

6. **View the trace**:
   - Open the frontend in your browser.
   - Paste the `traceId` into **Trace Search** or click it from the list.
   - The **Trace Detail** view shows:
     - Spans from Service A, B, and C.
     - A clear waterfall timeline.
     - Service C highlighted as the bottleneck.

### Architecture Notes

- **Stateless backend**:
  - No in-memory session or per-request state; everything is per-call based on headers and request body.
- **Horizontal scaling**:
  - Backend instances are stateless and share a single Postgres database.
  - Middleware is fire-and-forget and does not assume affinity.
- **API versioning**:
  - All endpoints are under `/api/v1`.
- **Security**:
  - API key via `x-api-key`.
  - Rate limiting for ingestion to protect the database.

This project is designed to be easy to integrate (one middleware line) while still being credible for a CTO demo: you can show a request traverse multiple services and immediately see where the latency lives. 

