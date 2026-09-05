/**
 * CORDON build tools — small filesystem helpers used by both pipelines.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export function exists(p: string): boolean {
  return existsSync(p);
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Writes `data` to `filePath` atomically: write to a sibling temp file, then
 * rename over the destination. Avoids partial files if the process is killed
 * mid-write (relevant here because generation can run for minutes).
 */
export function writeFileAtomic(filePath: string, data: string | NodeJS.ArrayBufferView): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, data);
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best effort cleanup
    }
    throw err;
  }
}
