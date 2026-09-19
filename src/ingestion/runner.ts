import {
  loadManifest,
  resolveBatchPath,
} from "../config/manifest.js";

import {
  fileExists,
  sha256File,
} from "./files.js";

import {
  parseBatchFile,
} from "./parsers.js";

import {
  insertRawRecords,
} from "./raw-store.js";

import {
  markRunCompleted,
  markRunFailed,
  prepareRun,
} from "./run-store.js";


type IngestionSummary = {
  filesCompleted: number;
  filesSkipped: number;
  filesMissing: number;
  rowsSeen: number;
  rowsInserted: number;
  rowsSkipped: number;
};


export async function runIngestion() {
  const manifest =
    await loadManifest();

  const summary: IngestionSummary = {
    filesCompleted: 0,
    filesSkipped: 0,
    filesMissing: 0,
    rowsSeen: 0,
    rowsInserted: 0,
    rowsSkipped: 0,
  };


  /*
   * Preserve configuration order.
   *
   * The fixture manifest orders batches sequentially
   * within each tenant/source, which also makes the
   * late-arrival behavior easy to observe.
   */
  for (const batch of manifest.batches) {
    const filePath =
      resolveBatchPath(batch);

    const exists =
      await fileExists(filePath);

    if (!exists) {
      summary.filesMissing += 1;

      console.warn(
        [
          "MISSING",
          `tenant=${batch.tenant}`,
          `source=${batch.source}`,
          `batch=${batch.batch}`,
          `path=${batch.path}`,
        ].join(" ")
      );

      /*
       * Do not create a successful ingestion run for
       * an expected file that never arrived.
       *
       * expected_batches remains the source of truth
       * for monitoring.
       */
      continue;
    }


    const fileHash =
      await sha256File(filePath);

    const decision =
      await prepareRun(
        batch,
        fileHash,
      );


    if (
      decision.action === "skip"
    ) {
      summary.filesSkipped += 1;

      console.log(
        [
          "SKIP",
          `tenant=${batch.tenant}`,
          `source=${batch.source}`,
          `batch=${batch.batch}`,
          "reason=already_completed",
        ].join(" ")
      );

      continue;
    }


    const runId =
      decision.runId;

    try {
      const parsed =
        await parseBatchFile(
          batch,
          filePath,
        );

      const stats =
        await insertRawRecords(
          batch,
          runId,
          parsed.records,
        );

      await markRunCompleted(
        batch.tenant,
        runId,
        stats,
      );

      summary.filesCompleted += 1;

      summary.rowsSeen +=
        stats.rowsSeen;

      summary.rowsInserted +=
        stats.rowsInserted;

      summary.rowsSkipped +=
        stats.rowsSkipped;


      console.log(
        [
          "OK",
          `tenant=${batch.tenant}`,
          `source=${batch.source}`,
          `batch=${batch.batch}`,
          `schema=${parsed.schemaVersion}`,
          `seen=${stats.rowsSeen}`,
          `inserted=${stats.rowsInserted}`,
          `skipped=${stats.rowsSkipped}`,
        ].join(" ")
      );
    } catch (error) {
      await markRunFailed(
        batch.tenant,
        runId,
        error,
      );

      console.error(
        [
          "FAILED",
          `tenant=${batch.tenant}`,
          `source=${batch.source}`,
          `batch=${batch.batch}`,
        ].join(" ")
      );

      throw error;
    }
  }


  console.log(
    "\n"
    + "=".repeat(60)
  );

  console.log(
    "INGESTION SUMMARY"
  );

  console.log(
    "=".repeat(60)
  );

  console.log(
    `Files completed: ${summary.filesCompleted}`
  );

  console.log(
    `Files skipped:   ${summary.filesSkipped}`
  );

  console.log(
    `Files missing:   ${summary.filesMissing}`
  );

  console.log(
    `Rows seen:       ${summary.rowsSeen}`
  );

  console.log(
    `Rows inserted:   ${summary.rowsInserted}`
  );

  console.log(
    `Rows skipped:    ${summary.rowsSkipped}`
  );


  return summary;
}