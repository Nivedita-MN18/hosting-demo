"use strict";
/**
 * Integration tests for TraceLite backend.
 * Uses Node's built-in `assert` and `http` — zero external test framework.
 * Run: node test/integration.js
 * Requires: DATABASE_URL and TRACELITE_API_KEY env vars (or a local .env).
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const assert = require("assert");
const http = require("http");

const BASE = `http://localhost:${process.env.PORT || 3001}`;
const KEY = process.env.TRACELITE_API_KEY || "";

const TEST_TRACE_ID = "550e8400-e29b-41d4-a716-446655440000";

let passed = 0;
let failed = 0;

async function request(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE + path);
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                "Content-Type": "application/json",
                "X-Api-Key": KEY,
                ...headers,
            },
        };
        if (data) opts.headers["Content-Length"] = Buffer.byteLength(data);
        const req = http.request(opts, (res) => {
            let raw = "";
            res.on("data", (chunk) => (raw += chunk));
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(raw) });
                } catch {
                    resolve({ status: res.statusCode, body: raw });
                }
            });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
    });
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✅  ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌  ${name}`);
        console.error(`       ${err.message}`);
        failed++;
    }
}

async function run() {
    console.log("\nTraceLite Integration Tests\n");

    // 1. Health check
    await test("GET /healthz returns ok", async () => {
        const res = await request("GET", "/healthz", null, { "X-Api-Key": "" });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ok, true);
    });

    // 2. Unauthenticated request is rejected
    await test("POST /api/v1/traces without key → 401", async () => {
        const res = await request("POST", "/api/v1/traces", {}, { "X-Api-Key": "wrong" });
        assert.strictEqual(res.status, 401);
    });

    // 3. Validation — missing fields
    await test("POST /api/v1/traces with missing fields → 400", async () => {
        const res = await request("POST", "/api/v1/traces", { traceId: TEST_TRACE_ID });
        assert.strictEqual(res.status, 400);
        assert.ok(res.body.error);
    });

    // 4. Valid ingestion
    await test("POST /api/v1/traces with valid payload → 201", async () => {
        const res = await request("POST", "/api/v1/traces", {
            traceId: TEST_TRACE_ID,
            service: "test-service",
            span: "integration-test",
            durationMs: 100,
            status: "OK",
            timestamp: Math.floor(Date.now() / 1000),
        });
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.inserted, true);
    });

    // 5. Idempotent — same payload returns 200, not 201
    await test("POST same span again → 200 (idempotent)", async () => {
        const ts = Math.floor(Date.now() / 1000) - 60; // fixed timestamp for dedup
        const payload = {
            traceId: TEST_TRACE_ID,
            service: "test-service",
            span: "idempotent-test",
            durationMs: 50,
            status: "OK",
            timestamp: ts,
        };
        const r1 = await request("POST", "/api/v1/traces", payload);
        assert.ok([200, 201].includes(r1.status));
        const r2 = await request("POST", "/api/v1/traces", payload);
        assert.strictEqual(r2.status, 200);
        assert.strictEqual(r2.body.inserted, false);
    });

    // 6. Get trace by ID
    await test("GET /api/v1/traces/:traceId returns spans sorted by timestamp", async () => {
        const res = await request("GET", `/api/v1/traces/${TEST_TRACE_ID}`);
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body.spans));
        assert.ok(res.body.spans.length > 0);
        // Verify timestamp ordering
        const ts = res.body.spans.map((s) => s.timestamp);
        for (let i = 1; i < ts.length; i++) {
            assert.ok(ts[i] >= ts[i - 1], "spans not sorted by timestamp");
        }
    });

    // 7. List traces
    await test("GET /api/v1/traces returns trace list", async () => {
        const res = await request("GET", "/api/v1/traces");
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body.traces));
    });

    // 8. Filter by service
    await test("GET /api/v1/traces?service=test-service returns filtered results", async () => {
        const res = await request("GET", "/api/v1/traces?service=test-service");
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.traces.length > 0);
    });

    // 9. Unknown traceId → 404
    await test("GET /api/v1/traces/:unknownId → 404", async () => {
        const res = await request("GET", "/api/v1/traces/00000000-0000-0000-0000-000000000000");
        assert.strictEqual(res.status, 404);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});
