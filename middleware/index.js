"use strict";
/**
 * tracelite-middleware
 *
 * One-line integration:
 *   const { traceMiddleware } = require("tracelite-middleware");
 *   app.use(traceMiddleware("my-service"));
 *
 * What this does:
 * 1. Reads X-Trace-Id from incoming request headers, or generates a fresh UUID.
 * 2. Stores traceId in an AsyncLocalStorage context so all code in the request
 *    chain can access it without thread-local hacks.
 * 3. Patches the Node.js http/https .request() to automatically inject
 *    X-Trace-Id into every outgoing HTTP call made during this request — enabling
 *    automatic propagation to downstream services.
 * 4. Sets X-Trace-Id on the response so the caller knows the traceId.
 * 5. On request finish, fires a span to the TraceLite API (fire-and-forget:
 *    never delays the response, never crashes the service if TraceLite is down).
 *
 * Config (env vars):
 *   TRACELITE_API_URL  — default: http://localhost:3001
 *   TRACELITE_API_KEY  — required when auth is enabled on the backend
 */

const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");
const https = require("https");
const { v4: uuidv4 } = require("uuid");

// One storage instance shared across all requests in this process.
// Each concurrent request gets its own store object.
const storage = new AsyncLocalStorage();

/**
 * Get the traceId for the currently executing async context.
 * Returns undefined if called outside a traced request.
 */
function currentTraceId() {
    const store = storage.getStore();
    return store ? store.traceId : undefined;
}

// --- HTTP propagation patch ---
// We intercept http.request and https.request at the module level once.
// When called inside a traced request, we inject X-Trace-Id automatically.
// This is the cleanest approach: zero changes required in application code.
function patchHttpForPropagation(mod) {
    const original = mod.request.bind(mod);
    mod.request = function (urlOrOptions, callbackOrOptions, maybeCallback) {
        const traceId = currentTraceId();
        if (traceId) {
            // Normalise the options object (urlOrOptions can be a string/URL or an object)
            if (typeof urlOrOptions === "string" || urlOrOptions instanceof URL) {
                // options are in callbackOrOptions when first arg is a URL
                if (typeof callbackOrOptions === "object" && callbackOrOptions !== null) {
                    callbackOrOptions.headers = callbackOrOptions.headers || {};
                    callbackOrOptions.headers["X-Trace-Id"] = traceId;
                }
            } else if (urlOrOptions && typeof urlOrOptions === "object") {
                urlOrOptions.headers = urlOrOptions.headers || {};
                urlOrOptions.headers["X-Trace-Id"] = traceId;
            }
        }
        return original(urlOrOptions, callbackOrOptions, maybeCallback);
    };
}

patchHttpForPropagation(http);
patchHttpForPropagation(https);

// --- Span emitter ---
// Fire-and-forget: we never await this on the hot path.
// If TraceLite is unreachable we log a warning and move on — tracing should
// NEVER affect the availability of the traced service.
function emitSpan(spanData) {
    const apiUrl = process.env.TRACELITE_API_URL || "http://localhost:3001";
    const apiKey = process.env.TRACELITE_API_KEY || "";
    const body = JSON.stringify(spanData);

    try {
        const url = new URL("/api/v1/traces", apiUrl);
        const isHttps = url.protocol === "https:";
        const mod = isHttps ? https : http;

        const req = mod.request(
            {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                    "X-Api-Key": apiKey,
                    // Deliberately omit X-Trace-Id here: the span emitter call
                    // shouldn't itself create a sub-trace.
                },
            },
            (res) => {
                // Drain the response body so Node can reuse the socket
                res.resume();
            }
        );

        req.on("error", (err) => {
            // Non-fatal: log once and continue
            console.warn(`[tracelite] Failed to emit span: ${err.message}`);
        });

        req.write(body);
        req.end();
    } catch (err) {
        console.warn(`[tracelite] Span emit error: ${err.message}`);
    }
}

/**
 * Classify request status.
 * SLOW threshold is 500ms — configurable via TRACELITE_SLOW_THRESHOLD_MS.
 */
function classifyStatus(statusCode, durationMs) {
    if (statusCode >= 500) return "ERROR";
    const slowThreshold = parseInt(process.env.TRACELITE_SLOW_THRESHOLD_MS) || 500;
    if (durationMs >= slowThreshold) return "SLOW";
    return "OK";
}

/**
 * traceMiddleware(serviceName)
 *
 * @param {string} serviceName - Human-readable name for this service (e.g. "order-service")
 * @returns Express middleware function
 */
function traceMiddleware(serviceName) {
    if (!serviceName || typeof serviceName !== "string") {
        throw new Error("traceMiddleware requires a non-empty serviceName string");
    }

    return function traceliteMiddleware(req, res, next) {
        // 1. Determine traceId: trust the incoming header (propagated from upstream) or mint a new one
        const traceId = req.headers["x-trace-id"] || uuidv4();
        const startTime = Date.now();

        // 2. Expose traceId to application code and downstream middleware
        req.traceId = traceId;

        // 3. Run the rest of the request pipeline inside the AsyncLocalStorage context.
        //    This is what makes currentTraceId() work from any depth of the call stack.
        storage.run({ traceId }, () => {
            // 4. Set the response header so the caller can correlate this response
            res.setHeader("X-Trace-Id", traceId);

            // 5. On finish, emit the span (non-blocking)
            res.on("finish", () => {
                const durationMs = Date.now() - startTime;
                const status = classifyStatus(res.statusCode, durationMs);

                emitSpan({
                    traceId,
                    service: serviceName,
                    span: `${req.method} ${req.path}`,
                    durationMs,
                    status,
                    timestamp: Math.floor(startTime / 1000),
                });
            });

            next();
        });
    };
}

module.exports = { traceMiddleware, currentTraceId };
