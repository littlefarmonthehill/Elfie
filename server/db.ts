import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => {
  console.error('[DB] Pool idle client error (handled):', err.message);
});

// Keep the connection warm so WebSocket doesn't go idle and crash on reconnect
setInterval(() => {
  pool.query('SELECT 1').catch((err) => {
    console.error('[DB] Keepalive query failed (handled):', err.message);
  });
}, 10000);

export const db = drizzle({ client: pool, schema });
