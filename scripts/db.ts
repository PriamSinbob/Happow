import 'dotenv/config';
import pg from 'pg';

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  return url;
}

export async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  // PostGIS lives in the "extensions" schema (Supabase convention).
  await client.query('set search_path = public, extensions');
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
