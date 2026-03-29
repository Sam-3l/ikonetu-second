import Knex from 'knex';
import { env } from '@ikonetu/config';

let _db: Knex.Knex;

export function getDb(): Knex.Knex {
  if (_db) return _db;

  _db = Knex({
    client: 'pg',
    connection: {
      host: env.DB_HOST,
      port: parseInt(env.DB_PORT),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    },
    pool: {
      min: parseInt(env.DB_POOL_MIN),
      max: parseInt(env.DB_POOL_MAX),
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
    },
    acquireConnectionTimeout: 30000,
  });

  // Test connection on startup
  _db.raw('SELECT 1').then(() => {
    console.log('✅ Database connected');
  }).catch((err: Error) => {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  });

  return _db;
}

export const db = new Proxy({} as Knex.Knex, {
  get(_, prop: string) {
    return getDb()[prop as keyof Knex.Knex];
  },
  apply(_, __, args) {
    return (getDb() as unknown as Function)(...args);
  },
});
