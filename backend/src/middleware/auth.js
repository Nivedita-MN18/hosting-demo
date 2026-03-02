"use strict";

/**
 * API key authentication middleware.
 *
 * Why static key instead of JWT?
 * For a traced microservice system, every service needs to POST spans.
 * JWT would require a token refresh loop — unnecessary complexity for a platform key.
 * A single long-lived API key (rotated via env var) is the correct pattern here.
 *
 * Accepts the key via:
 *   Authorization: Bearer <key>
 *   X-Api-Key: <key>
 */
function authMiddleware(req, res, next) {
    const apiKey = process.env.TRACELITE_API_KEY;

    // If no key is configured, auth is disabled (dev convenience)
    if (!apiKey) return next();

    const authHeader = req.headers["authorization"] || "";
    const xApiKey = req.headers["x-api-key"] || "";

    const provided =
        (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "") || xApiKey;

    if (!provided || provided !== apiKey) {
        return res.status(401).json({
            error: "Unauthorized",
            message: "Provide API key via 'Authorization: Bearer <key>' or 'X-Api-Key: <key>'",
        });
    }

    next();
}

module.exports = { authMiddleware };
