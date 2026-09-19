import {
  pool,
  withTenant,
} from "../db/client.js";


export async function printTenantReport(
  tenantId: string,
) {
  const tenant =
    await pool.query(
      `
      SELECT id
      FROM tenants
      WHERE id = $1
      `,
      [tenantId],
    );

  if (tenant.rowCount !== 1) {
    throw new Error(
      `Unknown tenant: ${tenantId}`
    );
  }


  await withTenant(
    tenantId,
    async (client) => {
      const orders =
        await client.query(
          `
          SELECT
            order_date,
            currency,
            orders,
            gross_revenue
          FROM mart_daily_orders
          ORDER BY order_date DESC
          LIMIT 10
          `,
        );


      const email =
        await client.query(
          `
          SELECT
            event_date,
            event_type,
            events
          FROM mart_daily_email_events
          ORDER BY event_date DESC, event_type
          LIMIT 20
          `,
        );


      const adSpend =
        await client.query(
          `
          SELECT
            spend_date,
            platform,
            spend_usd
          FROM mart_daily_ad_spend
          ORDER BY spend_date DESC, platform
          LIMIT 20
          `,
        );


      console.log(
        `\nTenant report: ${tenantId}`
      );

      console.log(
        "\nDaily orders"
      );

      console.table(
        orders.rows
      );


      console.log(
        "\nDaily email events"
      );

      console.table(
        email.rows
      );


      console.log(
        "\nDaily ad spend"
      );

      console.table(
        adSpend.rows
      );
    },
  );
}