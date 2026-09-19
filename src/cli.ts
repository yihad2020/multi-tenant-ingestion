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

    case "status":
      console.log(
        "Source status not implemented yet."
      );
      break;

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