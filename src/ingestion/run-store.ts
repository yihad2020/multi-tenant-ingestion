import {
  withTenant,
} from "../db/client.js";

import type {
  ManifestBatch,
} from "../config/manifest.js";


type ExistingRun = {
  id: string;
  status:
    | "running"
    | "completed"
    | "failed";
  attempt_count: number;
};


export type RunDecision =
  | {
      action: "skip";
      runId: string;
      attemptCount: number;
    }
  | {
      action: "process";
      runId: string;
      attemptCount: number;
    };


export type RunStats = {
  rowsSeen: number;
  rowsInserted: number;
  rowsSkipped: number;
};


export async function prepareRun(
  batch: ManifestBatch,
  fileHash: string,
): Promise<RunDecision> {
  return withTenant(
    batch.tenant,
    async (client) => {
      const existing =
        await client.query<ExistingRun>(
          `
          SELECT
            id,
            status,
            attempt_count
          FROM ingestion_runs
          WHERE
            tenant_id = $1
            AND source = $2
            AND file_hash = $3
          LIMIT 1
          `,
          [
            batch.tenant,
            batch.source,
            fileHash,
          ],
        );

      const previous =
        existing.rows[0];

      /*
       * Exact same file already finished successfully.
       *
       * There is nothing to replay.
       */
      if (
        previous?.status
        === "completed"
      ) {
        return {
          action: "skip",
          runId: previous.id,
          attemptCount:
            previous.attempt_count,
        };
      }


      /*
       * A previous attempt may be:
       *
       * - explicitly failed, or
       * - left "running" because the process died
       *   before it could mark the run failed.
       *
       * The record transaction will have rolled back,
       * so both states are safe to retry.
       */
      if (previous) {
        const retried =
          await client.query<{
            id: string;
            attempt_count: number;
          }>(
            `
            UPDATE ingestion_runs
            SET
              status = 'running',
              attempt_count =
                attempt_count + 1,
              rows_seen = 0,
              rows_inserted = 0,
              rows_skipped = 0,
              started_at = NOW(),
              finished_at = NULL,
              error_message = NULL
            WHERE id = $1
            RETURNING
              id,
              attempt_count
            `,
            [previous.id],
          );

        const run = retried.rows[0];

        if (!run) {
          throw new Error(
            "Failed to restart ingestion run."
          );
        }

        return {
          action: "process",
          runId: run.id,
          attemptCount:
            run.attempt_count,
        };
      }


      const inserted =
        await client.query<{
          id: string;
          attempt_count: number;
        }>(
          `
          INSERT INTO ingestion_runs (
            tenant_id,
            source,
            batch_number,
            source_path,
            file_hash,
            status
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            'running'
          )
          RETURNING
            id,
            attempt_count
          `,
          [
            batch.tenant,
            batch.source,
            batch.batch,
            batch.path,
            fileHash,
          ],
        );

      const run = inserted.rows[0];

      if (!run) {
        throw new Error(
          "Failed to create ingestion run."
        );
      }

      return {
        action: "process",
        runId: run.id,
        attemptCount:
          run.attempt_count,
      };
    },
  );
}


export async function markRunCompleted(
  tenantId: string,
  runId: string,
  stats: RunStats,
) {
  await withTenant(
    tenantId,
    async (client) => {
      await client.query(
        `
        UPDATE ingestion_runs
        SET
          status = 'completed',
          rows_seen = $2,
          rows_inserted = $3,
          rows_skipped = $4,
          finished_at = NOW(),
          error_message = NULL
        WHERE id = $1
        `,
        [
          runId,
          stats.rowsSeen,
          stats.rowsInserted,
          stats.rowsSkipped,
        ],
      );
    },
  );
}


export async function markRunFailed(
  tenantId: string,
  runId: string,
  error: unknown,
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  await withTenant(
    tenantId,
    async (client) => {
      await client.query(
        `
        UPDATE ingestion_runs
        SET
          status = 'failed',
          finished_at = NOW(),
          error_message = $2
        WHERE id = $1
        `,
        [
          runId,
          message.slice(0, 4000),
        ],
      );
    },
  );
}