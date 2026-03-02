"use strict";
const rateLimit = require("express-rate-limit");

/**
 * Ingestion limiter: generous for high-throughput span emission from services.
 * 200 req/min per IP. Each service POSTs one span per request — this comfortably
 * handles a cluster of 20 services handling 10 req/s each.
 */
const ingestLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many span ingestion requests. Retry after 60s." },
});

/**
 * Query limiter: dashboard/CLI calls — less volume expected.
 */
const queryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many query requests. Retry after 60s." },
});

module.exports = { ingestLimiter, queryLimiter };
