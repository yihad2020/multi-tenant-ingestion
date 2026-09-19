import {
  readdir,
  readFile,
} from "node:fs/promises";

import {
  fileURLToPath,
} from "node:url";

import { pool } from "./client.js";

const migrationsDirectory =
  fileURLToPath(
    new URL(
      "./migrations/",
      import.meta.url,
    )
  );

async function ensureMigrationTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
    )
  `);
}

export async function runMigrations() {
  await ensureMigrationTable();

  const files = (
    await readdir(
      migrationsDirectory
    )
  )
    .filter(
      (file) =>
        file.endsWith(".sql")
    )
    .sort();

  for (const filename of files) {
    const existing =
      await pool.query(
        `
        SELECT 1
        FROM schema_migrations
        WHERE filename = $1
        `,
        [filename],
      );

    if (
      existing.rowCount &&
      existing.rowCount > 0
    ) {
      console.log(
        `Skipping ${filename}`
      );

      continue;
    }

    const sql = await readFile(
      `${migrationsDirectory}/${filename}`,
      "utf8",
    );

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(sql);

      await client.query(
        `
        INSERT INTO schema_migrations (
          filename
        )
        VALUES ($1)
        `,
        [filename],
      );

      await client.query("COMMIT");

      console.log(
        `Applied ${filename}`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}