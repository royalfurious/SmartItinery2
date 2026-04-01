import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

function normalizeDatabaseUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    // If the user explicitly opted into libpq semantics, don't override.
    const useLibpqCompat = (url.searchParams.get('uselibpqcompat') || '').toLowerCase() === 'true';
    if (useLibpqCompat) return rawUrl;

    const sslmode = (url.searchParams.get('sslmode') || '').toLowerCase();
    // pg-connection-string currently treats these as aliases of verify-full, but
    // upcoming versions will switch to standard libpq semantics (weaker).
    if (sslmode === 'prefer' || sslmode === 'require' || sslmode === 'verify-ca') {
      url.searchParams.set('sslmode', 'verify-full');
      return url.toString();
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

const ssl =
  process.env.DB_SSL === 'true'
    ? {
        // Secure by default. If you *must* disable verification (not recommended), set:
        // DB_SSL_REJECT_UNAUTHORIZED=false
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      }
    : undefined;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL),
      max: 10,
      idleTimeoutMillis: 30000,
      ssl,
    })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'postgres',
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
      max: 10, // maximum number of clients in the pool
      idleTimeoutMillis: 30000, // close idle clients after 30 seconds
      ssl,
    });

export default pool;
