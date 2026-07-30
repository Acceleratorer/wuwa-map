import { resolve } from "node:path";
import { createDatabaseBackup } from "./database-maintenance.mjs";

function timestampForFileName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

const databasePath =
  process.env.DATABASE_PATH ?? "./data/wayfinder.sqlite";
const destinationPath = resolve(
  process.argv[2] ??
    `./backups/wayfinder-${timestampForFileName()}.sqlite`,
);

const result = await createDatabaseBackup(databasePath, destinationPath);
console.log(`Backup: ${result.destinationPath}`);
console.log(`Size: ${result.sizeBytes} bytes`);
console.log("Integrity: ok");
