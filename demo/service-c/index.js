"use strict";
/**
 * Service C — "inventory-service"
 * Fast responder (~30ms). The final node in the demo chain.
 * Shows that not every service is slow — the waterfall makes this obvious.
 */
const express = require("express");
const { traceMiddleware } = require("../../middleware");

const app = express();
app.use(traceMiddleware("inventory-service"));

app.get("/inventory", async (req, res) => {
    // Simulate minimal I/O (cache hit scenario)
    await sleep(30);
    res.json({
        service: "inventory-service",
        traceId: req.traceId,
        items: [
            { sku: "ITEM-001", available: 42 },
            { sku: "ITEM-002", available: 7 },
        ],
    });
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const PORT = process.env.PORT || 4003;
app.listen(PORT, () =>
    console.log(`[inventory-service] listening on http://localhost:${PORT}/inventory`)
);
