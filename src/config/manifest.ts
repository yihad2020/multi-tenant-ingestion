import "dotenv/config";

import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
  sep,
} from "node:path";

import { z } from "zod";


export const sourceNameSchema = z.enum([
  "orders",
  "email_events",
  "ad_spend",
]);

export type SourceName =
  z.infer<typeof sourceNameSchema>;


const dateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  "Expected YYYY-MM-DD date",
);


const manifestBatchSchema = z.object({
  tenant: z.string().min(1),

  source: sourceNameSchema,

  batch: z
    .number()
    .int()
    .positive(),

  path: z.string().min(1),

  covers_from: dateSchema,

  covers_to: dateSchema,
});


const manifestSchema = z.object({
  generated_for: z.string(),

  batches: z.array(
    manifestBatchSchema
  ),
});


export type ManifestBatch =
  z.infer<typeof manifestBatchSchema>;

export type Manifest =
  z.infer<typeof manifestSchema>;


export function getFixturesDirectory() {
  return resolve(
    process.cwd(),
    process.env.FIXTURES_DIR
      ?? "./fixtures",
  );
}


export function resolveBatchPath(
  batch: ManifestBatch,
) {
  const fixturesDirectory =
    getFixturesDirectory();

  const fullPath = resolve(
    fixturesDirectory,
    batch.path,
  );

  /*
   * Prevent a malformed manifest path from escaping
   * the configured fixtures directory.
   */
  const fixturesPrefix =
    fixturesDirectory.endsWith(sep)
      ? fixturesDirectory
      : `${fixturesDirectory}${sep}`;

  if (
    fullPath !== fixturesDirectory
    && !fullPath.startsWith(
      fixturesPrefix
    )
  ) {
    throw new Error(
      `Batch path escapes fixtures directory: ${batch.path}`
    );
  }

  return fullPath;
}


export async function loadManifest():
Promise<Manifest> {
  const fixturesDirectory =
    getFixturesDirectory();

  const manifestPath = resolve(
    fixturesDirectory,
    "manifest.json",
  );

  const contents = await readFile(
    manifestPath,
    "utf8",
  );

  const parsed = manifestSchema.parse(
    JSON.parse(contents)
  );

  /*
   * A tenant/source/batch combination must appear
   * only once in configuration.
   */
  const seen = new Set<string>();

  for (const batch of parsed.batches) {
    const key = [
      batch.tenant,
      batch.source,
      batch.batch,
    ].join(":");

    if (seen.has(key)) {
      throw new Error(
        `Duplicate manifest entry: ${key}`
      );
    }

    seen.add(key);

    if (
      batch.covers_from
      > batch.covers_to
    ) {
      throw new Error(
        `Invalid coverage window for ${key}`
      );
    }
  }

  return parsed;
}