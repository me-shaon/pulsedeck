import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

/** Create a postgres-js client. Later phases wrap this with Drizzle. */
export function createDb(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 10, onnotice: () => {} });
}

/** Lightweight liveness check used by the health endpoint. */
export async function pingDb(sql: Sql): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
