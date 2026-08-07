import { Pool } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';

/**
 * One long-lived pool for the process. This is the part a VPS buys you over
 * serverless: connections are opened once and reused for the life of the
 * service, so no request pays a TCP + TLS + auth handshake and there is no
 * connection-limit ceiling to dance around.
 *
 * It is built on first use rather than at import, for the same reason `env`'s
 * fields are getters: Next imports this module during `next build`, and a build
 * must not require a reachable database. It is also cached on `globalThis`,
 * because dev-mode hot reload re-evaluates the module on every edit and a fresh
 * `new Pool()` each time leaks Postgres backends until the server is restarted.
 */
const CACHE = Symbol.for('dor-quiz.pool');
type PoolCache = typeof globalThis & { [CACHE]?: Pool };

export function db(): Pool {
  const cache = globalThis as PoolCache;
  if (cache[CACHE]) return cache[CACHE];

  const pool = new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000
  });
  pool.on('error', err => {
    // A backend dying while idle must not take the process with it; the pool
    // will open a fresh connection on the next checkout.
    console.error('[db] idle client error', err);
  });
  cache[CACHE] = pool;
  return pool;
}

/**
 * Applies every migration in filename order at boot.
 *
 * They are written to be idempotent (`if not exists`) rather than tracked in a
 * versions table: at this size that is less machinery to get wrong, and it means
 * a restart after a failed deploy re-converges instead of wedging. Name new
 * files `002_*.sql`, `003_*.sql` — order is the sort order.
 *
 * The directory is resolved off `process.cwd()`, not `import.meta.url`: this
 * module is bundled by Next into .next/server, so a URL relative to the emitted
 * chunk points nowhere useful. `next start` runs from the project root, which is
 * where migrations/ sits.
 */
export async function migrate(): Promise<void> {
  const dir = path.join(process.cwd(), 'migrations');
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    await db().query(sql);
  }
}

/**
 * Runs `fn` inside a transaction, rolling back on any throw. Used by the routes
 * that write more than one row.
 */
export async function tx<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
