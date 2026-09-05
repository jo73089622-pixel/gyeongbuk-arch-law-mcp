import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config.js";

function resolveDataPath(fileName: string): string {
  return path.join(DATA_DIR, fileName);
}

export async function readJSON<T>(fileName: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fs.readFile(resolveDataPath(fileName), "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultValue;
    }
    throw err;
  }
}

export async function writeJSON<T>(fileName: string, data: T): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(resolveDataPath(fileName), JSON.stringify(data, null, 2), "utf-8");
}
