"use strict";
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");

// --- Validation schema (zod) ---
// All fields are required; status is an enum; timestamp must be a positive integer.
const ingestSchema = z.object({
    traceId: z
        .string()
        .uuid({ message: "traceId must be a valid UUID v4" }),
    service: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[\w\-.]+$/, "service may only contain word chars, hyphens, dots"),
    span: z.string().min(1).max(256),
    durationMs: z.number().int().nonnegative(),
    status: z.enum(["OK", "ERROR", "SLOW"]),
    timestamp: z.number().int().positive(),
});

/**
 * POST /api/v1/traces
 *
 * Ingest a single span. Idempotent — duplicate (traceId+service+span+timestamp)
 * is silently accepted (returns 200 instead of 201) courtesy of ON CONFLICT DO NOTHING.
 */
async function ingestSpan(req, res, next) {
    try {
        const parsed = ingestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: "Validation failed",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { traceId, service, span, durationMs, status, timestamp } = parsed.data;

        const result = await db.query(
            `INSERT INTO traces (trace_id, service, span, duration_ms, status, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT ux_traces_dedup DO NOTHING
       RETURNING id`,
            [traceId, service, span, durationMs, status, timestamp]
        );

        // rowCount === 0 means the row already existed → idempotent accept
        const inserted = result.rowCount > 0;
        return res.status(inserted ? 201 : 200).json({
            ok: true,
            inserted,
            traceId,
        });
    } catch (err) {
        next(err);
    }
}

/**
 * GET /api/v1/traces/:traceId
 *
 * Return all spans for a traceId, sorted by timestamp ascending.
 * Optimised for waterfall rendering: spans are ready to display in order.
 */
async function getTrace(req, res, next) {
    try {
        const { traceId } = req.params;

        // Validate traceId format before hitting the DB
        if (!z.string().uuid().safeParse(traceId).success) {
            return res.status(400).json({ error: "traceId must be a valid UUID" });
        }

        const result = await db.query(
            `SELECT trace_id AS "traceId", service, span, duration_ms AS "durationMs",
              status, timestamp
       FROM traces
       WHERE trace_id = $1
       ORDER BY timestamp ASC, id ASC`,
            [traceId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Trace not found" });
        }

        // Compute a timeline summary so the frontend doesn't have to
        const spans = result.rows;
        const minTs = Math.min(...spans.map((s) => s.timestamp));
        const maxTs = Math.max(...spans.map((s) => s.timestamp));
        const totalDurationMs = spans.reduce((sum, s) => sum + s.durationMs, 0);
        const slowestSpan = spans.reduce((a, b) => (a.durationMs > b.durationMs ? a : b));

        return res.json({
            traceId,
            spanCount: spans.length,
            totalDurationMs,
            slowestSpan: { service: slowestSpan.service, span: slowestSpan.span, durationMs: slowestSpan.durationMs },
            services: [...new Set(spans.map((s) => s.service))],
            spans,
        });
    } catch (err) {
        next(err);
    }
}

/**
 * GET /api/v1/traces
 *
 * List/filter spans across traces.
 * Query params: service, status, from (unix ts), to (unix ts), limit (default 50, max 200)
 *
 * Returns deduplicated traceIds with summary info — useful for the search page.
 */
async function listTraces(req, res, next) {
    try {
        const { service, status, from, to } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        const conditions = [];
        const params = [];

        if (service) {
            params.push(service);
            conditions.push(`service = $${params.length}`);
        }
        if (status) {
            if (!["OK", "ERROR", "SLOW"].includes(status)) {
                return res.status(400).json({ error: "status must be OK, ERROR, or SLOW" });
            }
            params.push(status);
            conditions.push(`status = $${params.length}`);
        }
        if (from) {
            const fromTs = parseInt(from);
            if (isNaN(fromTs)) return res.status(400).json({ error: "from must be a unix timestamp" });
            params.push(fromTs);
            conditions.push(`timestamp >= $${params.length}`);
        }
        if (to) {
            const toTs = parseInt(to);
            if (isNaN(toTs)) return res.status(400).json({ error: "to must be a unix timestamp" });
            params.push(toTs);
            conditions.push(`timestamp <= $${params.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

        // Group by traceId to get summary per trace (not per span)
        params.push(limit);
        const result = await db.query(
            `SELECT
         trace_id AS "traceId",
         array_agg(DISTINCT service) AS services,
         COUNT(*) AS "spanCount",
         SUM(duration_ms) AS "totalDurationMs",
         MAX(CASE WHEN status = 'ERROR' THEN 'ERROR'
                  WHEN status = 'SLOW'  THEN 'SLOW'
                  ELSE 'OK' END) AS "worstStatus",
         MIN(timestamp) AS "startedAt"
       FROM traces
       ${where}
       GROUP BY trace_id
       ORDER BY MIN(timestamp) DESC
       LIMIT $${params.length}`,
            params
        );

        return res.json({
            count: result.rows.length,
            traces: result.rows,
        });
    } catch (err) {
        next(err);
    }
}

module.exports = { ingestSpan, getTrace, listTraces };
