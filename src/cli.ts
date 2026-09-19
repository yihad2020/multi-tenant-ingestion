const command = process.argv[2];

switch (command) {
  case "migrate":
    console.log("Migrations not implemented yet.");
    break;

  case "ingest":
    console.log("Ingestion not implemented yet.");
    break;

  case "status":
    console.log("Source status not implemented yet.");
    break;

  default:
    console.log(`
Usage:

  npm run migrate
  npm run ingest
  npm run status
`);
}