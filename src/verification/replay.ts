import {
  pool,
  closePool,
} from "../db/client.js";

import {
  loadManifest,
  resolveBatchPath,
} from "../config/manifest.js";

import {
  sha256File,
} from "../ingestion/files.js";

import {
  parseBatchFile,
} from "../ingestion/parsers.js";

import {
  prepareRun,
} from "../ingestion/run-store.js";

import {
  insertRawRecords,
} from "../ingestion/raw-store.js";

import {
  runIngestion,
} from "../ingestion/runner.js";


async function main() {
  const manifest =
    await loadManifest();


  /*
   * Use a simple non-overlapping batch for the
   * controlled interruption demonstration.
   */
  const batch =
    manifest.batches.find(
      (candidate) =>
        candidate.tenant === "lumen"
        && candidate.source === "orders"
        && candidate.batch === 1
    );


  if (!batch) {
    throw new Error(
      "Replay verification batch not found."
    );
  }


  const path =
    resolveBatchPath(batch);

  const hash =
    await sha256File(path);


  console.log(
    "\nPreparing replay verification..."
  );


  /*
   * Reset only this exact completed file.
   *
   * This script is deliberately destructive to one
   * fixture batch, then restores it before exiting.
   *
   * Administrative access is appropriate here
   * because this is verification tooling rather
   * than an application code path.
   */
  await pool.query("BEGIN");

  try {
    await pool.query(
      `
      DELETE FROM raw_records
      WHERE ingestion_run_id IN (
        SELECT id
        FROM ingestion_runs
        WHERE
          tenant_id = $1
          AND source = $2
          AND file_hash = $3
      )
      `,
      [
        batch.tenant,
        batch.source,
        hash,
      ],
    );


    await pool.query(
      `
      DELETE FROM ingestion_runs
      WHERE
        tenant_id = $1
        AND source = $2
        AND file_hash = $3
      `,
      [
        batch.tenant,
        batch.source,
        hash,
      ],
    );

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }


  const parsed =
    await parseBatchFile(
      batch,
      path,
    );


  const decision =
    await prepareRun(
      batch,
      hash,
    );


  if (
    decision.action !== "process"
  ) {
    throw new Error(
      "Expected replay verification batch to process."
    );
  }


  const failAfter =
    Math.ceil(
      parsed.records.length / 3
    );


  console.log(
    `Simulating interruption after ${failAfter} rows...`
  );


  try {
    await insertRawRecords(
      batch,
      decision.runId,
      parsed.records,
      {
        simulateFailureAfterRows:
          failAfter,
      },
    );

    throw new Error(
      "Fault injection did not trigger."
    );
  } catch (error) {
    if (
      error instanceof Error
      && error.message
        .startsWith(
          "Simulated interruption"
        )
    ) {
      console.log(
        `Expected interruption: ${error.message}`
      );
    } else {
      throw error;
    }
  }


  /*
   * We deliberately DO NOT mark the run failed.
   *
   * This mimics a process dying after its data
   * transaction disappears but before it can update
   * ingestion_runs.
   *
   * The run therefore remains `running`.
   */
  const partial =
    await pool.query<{
      count: string;
    }>(
      `
      SELECT COUNT(*)::text AS count
      FROM raw_records
      WHERE ingestion_run_id = $1
      `,
      [decision.runId],
    );


  console.log(
    `Rows committed after interruption: ${partial.rows[0]?.count}`
  );


  if (
    partial.rows[0]?.count !== "0"
  ) {
    throw new Error(
      "Interrupted batch left partial rows committed."
    );
  }


  const beforeRetry =
    await pool.query<{
      status: string;
      attempt_count: number;
    }>(
      `
      SELECT
        status,
        attempt_count
      FROM ingestion_runs
      WHERE id = $1
      `,
      [decision.runId],
    );


  console.log(
    "Run before retry:",
    beforeRetry.rows[0]
  );


  console.log(
    "\nRe-running normal ingestion..."
  );


  await runIngestion();


  const afterRetry =
    await pool.query<{
      status: string;
      attempt_count: number;
      rows_inserted: number;
    }>(
      `
      SELECT
        status,
        attempt_count,
        rows_inserted
      FROM ingestion_runs
      WHERE id = $1
      `,
      [decision.runId],
    );


  console.log(
    "\nRun after retry:",
    afterRetry.rows[0]
  );


  const total =
    await pool.query<{
      count: string;
    }>(
      `
      SELECT COUNT(*)::text AS count
      FROM raw_records
      `,
    );


  console.log(
    `Final raw record count: ${total.rows[0]?.count}`
  );


  if (
    total.rows[0]?.count
    !== "4484"
  ) {
    throw new Error(
      "Replay verification did not restore expected raw record count."
    );
  }


  console.log(
    "\nReplay verification PASSED."
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