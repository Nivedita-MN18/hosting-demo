"use strict";
/**
 * Seed script — posts pre-canned spans to the TraceLite API so the dashboard
 * is immediately usable for a CTO demo without running all 3 services.
 *
 * Run: node demo/seed.js
 * Output: prints the traceId to paste into the frontend search box.
 */
const http = require("http");
const { v4: uuidv4 } = require("uuid");

const API_URL = process.env.TRACELITE_API_URL || "http://localhost:3001";
const API_KEY = process.env.TRACELITE_API_KEY || "dev-secret-key";

// A fixed traceId makes it easy to re-run the seed without polluting the DB
const DEMO_TRACE_ID = process.env.DEMO_TRACE_ID || uuidv4();
const NOW = Math.floor(Date.now() / 1000);

// These spans tell the story of one slow request through 3 services
const DEMO_SPANS = [
    {
        traceId: DEMO_TRACE_ID,
        service: "order-service",
        span: "GET /order",
        durationMs: 920,     // order-service total (wraps the whole chain)
        status: "SLOW",
        timestamp: NOW,
    },
    {
        traceId: DEMO_TRACE_ID,
        service: "payment-service",
        span: "GET /payment",
        durationMs: 855,     // payment-service including the slow DB call
        status: "SLOW",
        timestamp: NOW + 1,  // started 1s into the trace
    },
    {
        traceId: DEMO_TRACE_ID,
        service: "payment-service",
        span: "db-query",
        durationMs: 820,    // ← THE BOTTLENECK — highlighted in the waterfall
        status: "SLOW",
        timestamp: NOW + 1,
    },
    {
        traceId: DEMO_TRACE_ID,
        service: "inventory-service",
        span: "GET /inventory",
        durationMs: 35,     // fast — shows the contrast clearly
        status: "OK",
        timestamp: NOW + 2,
    },
];

function post(body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const url = new URL("/api/v1/traces", API_URL);
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 80,
                path: url.pathname,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(data),
                    "X-Api-Key": API_KEY,
                },
            },
            (res) => {
                let raw = "";
                res.on("data", (c) => (raw += c));
                res.on("end", () => resolve({ status: res.statusCode, body: raw }));
            }
        );
        req.on("error", reject);
        req.write(data);
        req.end();
    });
}

async function seed() {
    console.log("\n🌱  TraceLite Demo Seed\n");
    console.log(`   API:      ${API_URL}`);
    console.log(`   TraceId:  ${DEMO_TRACE_ID}\n`);

    for (const span of DEMO_SPANS) {
        const res = await post(span);
        const icon = res.status === 201 ? "✅" : res.status === 200 ? "⬛ (already exists)" : "❌";
        console.log(`   ${icon}  ${span.service} / ${span.span}  [${span.durationMs}ms, ${span.status}]`);
    }

    console.log("\n📋  Copy this traceId into the TraceLite dashboard:");
    console.log(`\n   ${DEMO_TRACE_ID}\n`);
    console.log("   Open frontend/index.html → paste traceId → View Trace\n");
}

seed().catch((err) => {
    console.error("Seed failed:", err.message);
    console.error("Is the backend running? (docker-compose up -d)");
    process.exit(1);
});
