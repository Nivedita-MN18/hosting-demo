"use strict";
require("dotenv").config();

const { runMigrations } = require("./db");
const app = require("./app");

const PORT = process.env.PORT || 3001;

async function main() {
    // Run idempotent schema migrations before accepting traffic.
    // This keeps the deployment atomic: server only starts when the DB is ready.
    try {
        await runMigrations();
    } catch (err) {
        console.error("[startup] Failed to run DB migrations:", err.message);
        console.error("Check DATABASE_URL and that PostgreSQL is reachable.");
        process.exit(1);
    }

    const server = app.listen(PORT, () => {
        console.log(`[tracelite] API server running on http://localhost:${PORT}`);
        console.log(`[tracelite] Environment: ${process.env.NODE_ENV || "development"}`);
        console.log(`[tracelite] Auth: ${process.env.TRACELITE_API_KEY ? "enabled" : "disabled (no key set)"}`);
    });

    // Graceful shutdown on SIGTERM (Docker stop) / SIGINT (Ctrl-C)
    const shutdown = () => {
        console.log("[tracelite] Shutting down...");
        server.close(() => process.exit(0));
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}

main();
