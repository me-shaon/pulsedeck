import postgres from 'postgres';

/**
 * Direct DB access for E2E preconditions. The suite needs to put the app into a
 * known state — notably "zero users" so the first-run setup wizard is reachable.
 * Connects to the same Postgres the API uses (override via DATABASE_URL).
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://pulsedeck:pulsedeck@localhost:5544/pulsedeck';

/** Truncate all auth + workspace state so `setupRequired` is true again. */
export async function resetToZeroUsers(): Promise<void> {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`TRUNCATE users, session, account, verification, workspaces, workspace_members CASCADE`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
