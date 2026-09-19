import {
  readFile,
} from "node:fs/promises";

import {
  parse,
} from "csv-parse/sync";

import { z } from "zod";

import type {
  ManifestBatch,
} from "../config/manifest.js";


export type ParsedRecord = {
  recordKey: string;
  payload: Record<string, unknown>;
};


export type ParsedFile = {
  records: ParsedRecord[];
  schemaVersion: string;
};


const numericString = z.string().regex(
  /^-?\d+(?:\.\d+)?$/,
  "Expected numeric value",
);


const orderSchema = z.object({
  order_id: z.string().min(1),
  created_at: z.string().min(1),
  channel: z.string().min(1),
  gross: numericString,
  currency: z.string().length(3),
  customer_email: z.string().min(1),
});


const emailEventSchema = z.object({
  event_id: z.string().min(1),
  type: z.string().min(1),
  email: z.string().min(1),
  campaign_id: z.string().min(1),
  occurred_at: z.string().min(1),
});


const adSpendV1Schema = z.object({
  date: z.string().min(1),
  campaign_id: z.string().min(1),
  platform: z.string().min(1),
  spend: numericString,
});


const adSpendV2Schema = z.object({
  date: z.string().min(1),
  campaign_id: z.string().min(1),
  platform: z.string().min(1),
  cost_usd: numericString,
});


function parseCsv(
  contents: string,
): Record<string, string>[] {
  return parse(
    contents,
    {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    },
  );
}


function sortedKeys(
  value: Record<string, unknown>,
) {
  return Object.keys(value).sort();
}


function sameColumns(
  actual: string[],
  expected: string[],
) {
  return (
    actual.length === expected.length
    && actual.every(
      (value, index) =>
        value === expected[index]
    )
  );
}


function detectAdSpendSchema(
  row: Record<string, string>,
): "v1" | "v2" {
  const actual =
    sortedKeys(row);

  const v1 = [
    "campaign_id",
    "date",
    "platform",
    "spend",
  ].sort();

  const v2 = [
    "campaign_id",
    "cost_usd",
    "date",
    "platform",
  ].sort();

  if (
    sameColumns(actual, v1)
  ) {
    return "v1";
  }

  if (
    sameColumns(actual, v2)
  ) {
    return "v2";
  }

  throw new Error(
    "Unknown ad_spend schema. "
    + `Received columns: ${actual.join(", ")}`
  );
}


function parseOrders(
  contents: string,
): ParsedFile {
  const rows = parseCsv(contents);

  const records =
    rows.map(
      (row, index) => {
        const parsed =
          orderSchema.safeParse(row);

        if (!parsed.success) {
          throw new Error(
            `Invalid order row ${index + 2}: `
            + parsed.error.message
          );
        }

        return {
          recordKey:
            parsed.data.order_id,

          // Preserve the source record as received.
          payload: row,
        };
      },
    );

  return {
    records,
    schemaVersion: "orders_v1",
  };
}


function parseEmailEvents(
  contents: string,
): ParsedFile {
  const records: ParsedRecord[] = [];

  const lines = contents
    .split(/\r?\n/)
    .filter(
      (line) => line.trim() !== ""
    );

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    const line = lines[index];

    if (!line) {
      continue;
    }

    let raw: unknown;

    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(
        `Invalid JSON in email_events line ${index + 1}`
      );
    }

    const parsed =
      emailEventSchema.safeParse(raw);

    if (!parsed.success) {
      throw new Error(
        `Invalid email event line ${index + 1}: `
        + parsed.error.message
      );
    }

    records.push({
      recordKey:
        parsed.data.event_id,

      payload:
        raw as Record<string, unknown>,
    });
  }

  return {
    records,
    schemaVersion:
      "email_events_v1",
  };
}


function parseAdSpend(
  contents: string,
): ParsedFile {
  const rows = parseCsv(contents);

  if (rows.length === 0) {
    return {
      records: [],
      schemaVersion:
        "ad_spend_empty",
    };
  }

  const firstRow = rows[0];

  if (!firstRow) {
    throw new Error(
      "Unable to inspect ad_spend schema."
    );
  }

  const version =
    detectAdSpendSchema(firstRow);

  const schema =
    version === "v1"
      ? adSpendV1Schema
      : adSpendV2Schema;

  const records =
    rows.map(
      (row, index) => {
        const parsed =
          schema.safeParse(row);

        if (!parsed.success) {
          throw new Error(
            `Invalid ad_spend row ${index + 2}: `
            + parsed.error.message
          );
        }

        /*
         * Natural identity is independent of the
         * spend column name.
         *
         * tenant_id is enforced separately by the
         * database unique constraint.
         */
        const recordKey = [
          row.date,
          row.campaign_id,
          row.platform,
        ].join("|");

        return {
          recordKey,
          payload: row,
        };
      },
    );

  return {
    records,
    schemaVersion:
      `ad_spend_${version}`,
  };
}


export async function parseBatchFile(
  batch: ManifestBatch,
  filePath: string,
): Promise<ParsedFile> {
  const contents =
    await readFile(
      filePath,
      "utf8",
    );

  switch (batch.source) {
    case "orders":
      return parseOrders(contents);

    case "email_events":
      return parseEmailEvents(
        contents
      );

    case "ad_spend":
      return parseAdSpend(contents);
  }
}