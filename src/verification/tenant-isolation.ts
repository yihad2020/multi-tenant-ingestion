import {
  closePool,
  withTenant,
} from "../db/client.js";


async function main() {
  console.log(
    "\nVerifying tenant isolation..."
  );


  const northwind =
    await withTenant(
      "northwind",
      async (client) => {
        const visibleTenants =
          await client.query<{
            tenant_id: string;
          }>(
            `
            SELECT DISTINCT tenant_id
            FROM raw_records
            ORDER BY tenant_id
            `,
          );


        const lumenRows =
          await client.query<{
            count: string;
          }>(
            `
            SELECT COUNT(*)::text AS count
            FROM raw_records
            WHERE tenant_id = 'lumen'
            `,
          );


        const martRows =
          await client.query<{
            count: string;
          }>(
            `
            SELECT COUNT(*)::text AS count
            FROM mart_daily_orders
            WHERE tenant_id = 'lumen'
            `,
          );


        return {
          visibleTenants:
            visibleTenants.rows.map(
              (row) => row.tenant_id
            ),

          lumenRawRows:
            lumenRows.rows[0]?.count,

          lumenMartRows:
            martRows.rows[0]?.count,
        };
      },
    );


  console.log(
    "Northwind context:",
    northwind,
  );


  if (
    northwind.visibleTenants.length !== 1
    || northwind.visibleTenants[0]
      !== "northwind"
  ) {
    throw new Error(
      "Northwind context can see another tenant."
    );
  }


  if (
    northwind.lumenRawRows !== "0"
    || northwind.lumenMartRows !== "0"
  ) {
    throw new Error(
      "Cross-tenant reads were not blocked."
    );
  }


  const lumen =
    await withTenant(
      "lumen",
      async (client) => {
        const visibleTenants =
          await client.query<{
            tenant_id: string;
          }>(
            `
            SELECT DISTINCT tenant_id
            FROM raw_records
            ORDER BY tenant_id
            `,
          );

        return visibleTenants.rows.map(
          (row) => row.tenant_id
        );
      },
    );


  console.log(
    "Lumen context:",
    lumen,
  );


  if (
    lumen.length !== 1
    || lumen[0] !== "lumen"
  ) {
    throw new Error(
      "Lumen context can see another tenant."
    );
  }


  /*
   * Now verify writes are also protected.
   *
   * A Northwind application session tries to insert
   * a Lumen row. PostgreSQL RLS must reject it.
   */
  let crossTenantWriteBlocked =
    false;


  try {
    await withTenant(
      "northwind",
      async (client) => {
        await client.query(
          `
          INSERT INTO expected_batches (
            tenant_id,
            source,
            batch_number,
            source_path,
            covers_from,
            covers_to
          )
          VALUES (
            'lumen',
            'orders',
            9999,
            'verification/should-not-exist.csv',
            DATE '2099-01-01',
            DATE '2099-01-01'
          )
          `,
        );
      },
    );
  } catch {
    crossTenantWriteBlocked =
      true;

    console.log(
      "Cross-tenant write: BLOCKED"
    );
  }


  if (!crossTenantWriteBlocked) {
    throw new Error(
      "Cross-tenant write was unexpectedly allowed."
    );
  }


  console.log(
    "\nTenant isolation verification PASSED."
  );
}


main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });