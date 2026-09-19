import {
  createHash,
} from "node:crypto";

import {
  createReadStream,
} from "node:fs";

import {
  access,
} from "node:fs/promises";


export async function fileExists(
  path: string,
): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}


export async function sha256File(
  path: string,
): Promise<string> {
  return new Promise(
    (resolveHash, reject) => {
      const hash = createHash(
        "sha256"
      );

      const stream =
        createReadStream(path);

      stream.on(
        "data",
        (chunk) => {
          hash.update(chunk);
        },
      );

      stream.on(
        "end",
        () => {
          resolveHash(
            hash.digest("hex")
          );
        },
      );

      stream.on(
        "error",
        reject,
      );
    },
  );
}