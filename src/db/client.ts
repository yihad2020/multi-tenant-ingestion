import "dotenv/config";

import pg, {
  type PoolClient,
} from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required."
  );
}

export const pool = new Pool({
  connectionString,
});

/**
 * Run application work inside an explicit tenant boundary.
 *
 * The database connection itself uses the local administrative
 * account, but application queries temporarily assume the limited
 * `pipeline_app` role.
 *
 * PostgreSQL Row-Level Security then restricts tenant-scoped tables
 * to the tenant stored in `app.tenant_id`.
 */
export async function withTenant<T>(
  tenantId: string,
  work: (
    client: PoolClient
  ) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Switch from the database owner to the restricted application role.
    await client.query(
      "SET LOCAL ROLE pipeline_app"
    );

    // Parameterized session context used by RLS policies.
    await client.query(
      `
      SELECT set_config(
        'app.tenant_id',
        $1,
        true
      )
      `,
      [tenantId],
    );

    const result = await work(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}