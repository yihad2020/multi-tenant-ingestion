import {
  closePool,
} from "./db/client.js";

import {
  runMigrations,
} from "./db/migrate.js";

import {
  syncManifestConfiguration,
} from "./config/sync.js";

import {
  runIngestion,
} from "./ingestion/runner.js";

import {
  reportSourceStatus,
} from "./monitoring/source-status.js";

import {
  printTenantReport,
} from "./modeling/report.js";

const command = process.argv[2];


async function main() {
  switch (command) {
    case "migrate":
      await runMigrations();
      break;

    case "sync":
      await syncManifestConfiguration();
      break;

    case "ingest":
      await runIngestion();
      break;

    case "status": {
      const result =
        await reportSourceStatus();

      if (!result.healthy) {
        /*
        * Monitoring-friendly non-zero exit code.
        *
        * The supplied fixtures intentionally contain
        * one missing batch, so exit code 2 is expected
        * for the assessment dataset.
        */
        process.exitCode = 2;
      }

      break;
}
    case "report": {
      const tenantId =
        process.argv[3];

      if (!tenantId) {
        throw new Error(
          "Usage: npm run report -- <tenant-id>"
        );
      }

      await printTenantReport(
        tenantId
      );

      break;
}

    default:
      console.log(`
Usage:

  npm run migrate
  npm run sync
  npm run ingest
  npm run status
`);
  }
}


main()
  .catch(
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  )
  .finally(
    async () => {
      await closePool();
    },
  );