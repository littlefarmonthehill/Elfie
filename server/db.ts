import pg from 'pg';
const { Pool } = pg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 300000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] Idle client error (handled):', err.message);
});

// Keepalive: run a lightweight query every 4 minutes to prevent Neon
// serverless from suspending its compute during idle periods. This avoids
// the 1-2s reconnect delay that can destabilize the server.
setInterval(() => {
  pool.query('SELECT 1').catch((err: Error) => {
    console.error('[DB] Keepalive query failed (will retry):', err.message);
  });
}, 4 * 60 * 1000);

export const db = drizzle(pool, { schema });
