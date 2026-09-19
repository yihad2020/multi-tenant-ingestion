import {
  pool,
  withTenant,
} from "../db/client.js";

import {
  loadManifest,
} from "./manifest.js";


export async function syncManifestConfiguration() {
  const manifest = await loadManifest();

  const tenantIds = [
    ...new Set(
      manifest.batches.map(
        (batch) => batch.tenant
      )
    ),
  ].sort();


  /*
   * Tenants are discovered from configuration.
   *
   * Adding a third tenant to the manifest therefore
   * does not require a code branch or new database
   * model.
   */
  for (const tenantId of tenantIds) {
    await pool.query(
      `
      INSERT INTO tenants (
        id,
        display_name
      )
      VALUES (
        $1,
        $1
      )
      ON CONFLICT (id)
      DO NOTHING
      `,
      [tenantId],
    );
  }


  /*
   * expected_batches is tenant-scoped by RLS, so
   * synchronize each tenant inside its own database
   * tenant context.
   */
  for (const tenantId of tenantIds) {
    const tenantBatches =
      manifest.batches.filter(
        (batch) =>
          batch.tenant === tenantId
      );

    await withTenant(
      tenantId,
      async (client) => {
        for (
          const batch
          of tenantBatches
        ) {
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
              $1,
              $2,
              $3,
              $4,
              $5,
              $6
            )
            ON CONFLICT (
              tenant_id,
              source,
              batch_number
            )
            DO UPDATE SET
              source_path =
                EXCLUDED.source_path,

              covers_from =
                EXCLUDED.covers_from,

              covers_to =
                EXCLUDED.covers_to
            `,
            [
              tenantId,
              batch.source,
              batch.batch,
              batch.path,
              batch.covers_from,
              batch.covers_to,
            ],
          );
        }
      },
    );
  }

  console.log(
    `Synced ${tenantIds.length} tenants `
    + `and ${manifest.batches.length} expected batches.`
  );
}