"use strict";
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { authMiddleware } = require("./middleware/auth");
const { ingestLimiter, queryLimiter } = require("./middleware/rateLimit");
const { ingestSpan, getTrace, listTraces } = require("./routes/traces");

const app = express();

// --- Global middleware ---
// CORS: allow any origin so the static frontend can call this from file:// or any CDN
app.use(cors());
app.use(express.json({ limit: "64kb" })); // Spans are tiny; cap body size

// Health check — no auth so load balancers / k8s probes can call freely
app.get("/healthz", (_req, res) => res.json({ ok: true, service: "tracelite-api" }));

// --- API v1 routes —— all require auth ---
const v1 = express.Router();
v1.use(authMiddleware);

// Ingestion: POST a span
v1.post("/traces", ingestLimiter, ingestSpan);

// Query: get a specific trace by ID
v1.get("/traces/:traceId", queryLimiter, getTrace);

// Query: list/filter traces
v1.get("/traces", queryLimiter, listTraces);

app.use("/api/v1", v1);

// --- 404 handler for unrecognised routes ---
app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
});

// --- Centralised error handler ---
// Express requires exactly 4 params to detect this as an error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
    console.error("[error]", err.message, err.stack);
    const status = err.status || 500;
    res.status(status).json({
        error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
});

module.exports = app;
