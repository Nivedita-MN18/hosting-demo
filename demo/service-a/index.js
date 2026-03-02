"use strict";
/**
 * Service A — "order-service"
 * The entry point for the demo request chain.
 * Receives a request, adds tracing middleware, then calls Service B.
 *
 * Flow: Client → Service A → Service B → Service C
 */
require("dotenv").config({ path: require("path").join(__dirname, "../../middleware/.env") });

const express = require("express");
const http = require("http");
// Use the local middleware package by relative path (no npm publish needed for demo)
const { traceMiddleware } = require("../../middleware");

const app = express();

// One line — this is the whole integration story
app.use(traceMiddleware("order-service"));

app.get("/order", async (req, res) => {
    try {
        // Call Service B, propagating traceId via the patched http.request
        const paymentResult = await httpGet(`http://localhost:4002/payment`, req.traceId);
        res.json({
            service: "order-service",
            traceId: req.traceId,
            status: "fulfilled",
            payment: paymentResult,
        });
    } catch (err) {
        res.status(500).json({ error: err.message, traceId: req.traceId });
    }
});

/**
 * Simple promisified GET helper — uses Node's built-in http module.
 * The tracing middleware has already patched http.request to inject X-Trace-Id.
 */
function httpGet(url, traceId) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const req = http.request(
            {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname,
                method: "GET",
                headers: {
                    // Explicit for demo clarity; the http patch would add this too
                    "X-Trace-Id": traceId,
                },
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve(data);
                    }
                });
            }
        );
        req.on("error", reject);
        req.end();
    });
}

const PORT = process.env.PORT || 4001;
app.listen(PORT, () =>
    console.log(`[order-service] listening on http://localhost:${PORT}/order`)
);
