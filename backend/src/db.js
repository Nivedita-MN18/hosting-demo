"use strict";
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// A single shared pool is safe for stateless HTTP servers.
// Pool size defaults (10 conns) are fine for a demo; tune via PG_POOL_SIZE env in prod.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Fail fast during startup rather than lazily on first query
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[db] unexpected pool error", err.message);
});

/**
 * Run a query against the pool. Returns the pg Result object.
 * Callers import this instead of reaching into the pool directly.
 */
async function query(sql, params) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

/**
 * Run the schema.sql bootstrap script once per server start.
 * Using CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS makes this safe to
 * call on every boot — no separate migration runner needed for a v1 system.
 */
async function runMigrations() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  console.log("[db] schema migrations applied");
}

module.exports = { query, runMigrations, pool };
