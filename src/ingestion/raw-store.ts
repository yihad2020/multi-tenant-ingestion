import {
  withTenant,
} from "../db/client.js";

import type {
  ManifestBatch,
} from "../config/manifest.js";

import type {
  ParsedRecord,
} from "./parsers.js";

import type {
  RunStats,
} from "./run-store.js";


export async function insertRawRecords(
  batch: ManifestBatch,
  runId: string,
  records: ParsedRecord[],
): Promise<RunStats> {
  return withTenant(
    batch.tenant,
    async (client) => {
      let rowsInserted = 0;
      let rowsSkipped = 0;

      /*
       * The entire batch is inside the transaction
       * created by withTenant().
       *
       * If the process throws halfway through this
       * function, PostgreSQL rolls the batch back.
       */
      for (const record of records) {
        const result =
          await client.query(
            `
            INSERT INTO raw_records (
              tenant_id,
              source,
              record_key,
              payload,
              source_path,
              ingestion_run_id
            )
            VALUES (
              $1,
              $2,
              $3,
              $4::jsonb,
              $5,
              $6
            )
            ON CONFLICT (
              tenant_id,
              source,
              record_key
            )
            DO NOTHING
            RETURNING id
            `,
            [
              batch.tenant,
              batch.source,
              record.recordKey,
              JSON.stringify(
                record.payload
              ),
              batch.path,
              runId,
            ],
          );

        if (result.rowCount === 1) {
          rowsInserted += 1;
        } else {
          rowsSkipped += 1;
        }
      }

      return {
        rowsSeen:
          records.length,

        rowsInserted,
        rowsSkipped,
      };
    },
  );
}