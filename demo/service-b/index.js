"use strict";
/**
 * Service B — "payment-service"
 * Simulates a slow DB call to make the bottleneck visible in the waterfall.
 * This is where the SLOW span comes from in the demo.
 *
 * Flow: Service A → Service B → Service C
 */
const express = require("express");
const http = require("http");
const { traceMiddleware } = require("../../middleware");

const app = express();
app.use(traceMiddleware("payment-service"));

app.get("/payment", async (req, res) => {
    // Simulate a slow database query — this is the BOTTLENECK we will highlight in the UI
    const dbStart = Date.now();
    await sleep(820); // 820ms intentional delay
    const dbLatency = Date.now() - dbStart;

    try {
        // Call inventory service downstream
        const inventory = await httpGet(`http://localhost:4003/inventory`, req.traceId);
        res.json({
            service: "payment-service",
            traceId: req.traceId,
            status: "charged",
            dbLatencyMs: dbLatency,
            inventory,
        });
    } catch (err) {
        res.status(500).json({ error: err.message, traceId: req.traceId });
    }
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(url, traceId) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const req = http.request(
            {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname,
                method: "GET",
                headers: { "X-Trace-Id": traceId },
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(data); }
                });
            }
        );
        req.on("error", reject);
        req.end();
    });
}

const PORT = process.env.PORT || 4002;
app.listen(PORT, () =>
    console.log(`[payment-service] listening on http://localhost:${PORT}/payment`)
);
