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


type InsertRawOptions = {
  /**
   * Verification-only fault injection.
   *
   * Production callers leave this undefined.
   */
  simulateFailureAfterRows?: number;
};


export async function insertRawRecords(
  batch: ManifestBatch,
  runId: string,
  records: ParsedRecord[],
  options: InsertRawOptions = {},
): Promise<RunStats> {
  return withTenant(
    batch.tenant,
    async (client) => {
      let rowsInserted = 0;
      let rowsSkipped = 0;
      let rowsProcessed = 0;

      /*
       * The entire batch is inside the transaction
       * created by withTenant().
       *
       * If an error is thrown halfway through,
       * withTenant() rolls the transaction back.
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

        rowsProcessed += 1;

        /*
         * Verification-only crash simulation.
         *
         * Throwing here causes the entire batch
         * transaction to roll back.
         */
        if (
          options.simulateFailureAfterRows
            !== undefined
          && rowsProcessed
            >= options.simulateFailureAfterRows
        ) {
          throw new Error(
            `Simulated interruption after ${rowsProcessed} rows`
          );
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