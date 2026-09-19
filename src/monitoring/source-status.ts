import {
  resolve,
} from "node:path";

import {
  pool,
  withTenant,
} from "../db/client.js";

import {
  getFixturesDirectory,
} from "../config/manifest.js";

import {
  fileExists,
} from "../ingestion/files.js";


type BatchStatusRow = {
  tenant_id: string;
  source: string;
  batch_number: number;
  source_path: string;
 covers_from: string | Date;
 covers_to: string | Date;

  run_status:
    | "running"
    | "completed"
    | "failed"
    | null;

  started_at: Date | null;
  finished_at: Date | null;
  error_message: string | null;
};


type StatusCounts = {
  completed: number;
  missing: number;
  pending: number;
  failed: number;
  running: number;
};


export async function reportSourceStatus() {
  const tenants =
    await pool.query<{
      id: string;
    }>(
      `
      SELECT id
      FROM tenants
      ORDER BY id
      `,
    );

  const rows: BatchStatusRow[] = [];


  /*
   * Read each tenant through the same RLS boundary
   * used by the application.
   */
  for (const tenant of tenants.rows) {
    const result =
      await withTenant(
        tenant.id,
        async (client) =>
          client.query<BatchStatusRow>(
            `
            SELECT
              eb.tenant_id,
              eb.source,
              eb.batch_number,
              eb.source_path,
              eb.covers_from,
              eb.covers_to,

              latest.status
                AS run_status,

              latest.started_at,
              latest.finished_at,
              latest.error_message

            FROM expected_batches eb

            LEFT JOIN LATERAL (
              SELECT
                ir.status,
                ir.started_at,
                ir.finished_at,
                ir.error_message

              FROM ingestion_runs ir

              WHERE
                ir.tenant_id =
                  eb.tenant_id

                AND ir.source =
                  eb.source

                AND ir.batch_number =
                  eb.batch_number

              ORDER BY
                ir.started_at DESC

              LIMIT 1
            ) latest
              ON TRUE

            ORDER BY
              eb.source,
              eb.batch_number
            `,
          ),
      );

    rows.push(...result.rows);
  }


  const counts: StatusCounts = {
    completed: 0,
    missing: 0,
    pending: 0,
    failed: 0,
    running: 0,
  };

  function formatDate(
  value: string | Date,
) {
  if (value instanceof Date) {
    return value
      .toISOString()
      .slice(0, 10);
  }

  return String(value)
    .slice(0, 10);
}


  console.log(
    "\n"
    + "=".repeat(60)
  );

  console.log(
    "SOURCE STATUS"
  );

  console.log(
    "=".repeat(60)
  );


  for (const row of rows) {
    const localPath = resolve(
      getFixturesDirectory(),
      row.source_path,
    );

    const exists =
      await fileExists(localPath);


    if (!exists) {
      counts.missing += 1;

      console.log(
        [
          "MISSING",
          `tenant=${row.tenant_id}`,
          `source=${row.source}`,
          `batch=${row.batch_number}`,
          `window=${formatDate(row.covers_from)}..${formatDate(row.covers_to)}`,
          `path=${row.source_path}`,
        ].join(" ")
      );

      continue;
    }


    if (!row.run_status) {
      counts.pending += 1;

      console.log(
        [
          "PENDING",
          `tenant=${row.tenant_id}`,
          `source=${row.source}`,
          `batch=${row.batch_number}`,
        ].join(" ")
      );

      continue;
    }


    switch (row.run_status) {
      case "completed":
        counts.completed += 1;
        break;

      case "failed":
        counts.failed += 1;

        console.log(
          [
            "FAILED",
            `tenant=${row.tenant_id}`,
            `source=${row.source}`,
            `batch=${row.batch_number}`,
            `error=${row.error_message ?? "unknown"}`,
          ].join(" ")
        );

        break;

      case "running":
        counts.running += 1;

        console.log(
          [
            "RUNNING",
            `tenant=${row.tenant_id}`,
            `source=${row.source}`,
            `batch=${row.batch_number}`,
          ].join(" ")
        );

        break;
    }
  }


  console.log(
    "\n"
    + "-".repeat(60)
  );

  console.log(
    `Expected batches: ${rows.length}`
  );

  console.log(
    `Completed:        ${counts.completed}`
  );

  console.log(
    `Missing:          ${counts.missing}`
  );

  console.log(
    `Pending:          ${counts.pending}`
  );

  console.log(
    `Failed:           ${counts.failed}`
  );

  console.log(
    `Running:          ${counts.running}`
  );


  const healthy =
    counts.missing === 0
    && counts.pending === 0
    && counts.failed === 0
    && counts.running === 0;


  if (!healthy) {
    console.log(
      "\nPipeline status: ATTENTION REQUIRED"
    );
  } else {
    console.log(
      "\nPipeline status: HEALTHY"
    );
  }


  return {
    healthy,
    counts,
  };
}