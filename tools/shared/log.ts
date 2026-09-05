/**
 * CORDON build tools — shared logging helpers.
 *
 * Plain console wrappers with a consistent `[tag]` prefix. Never pass secret
 * values through these — see tools/shared/secrets.ts for the "present: yes/no"
 * convention used to report key status without leaking it.
 */

export function info(tag: string, message: string): void {
  console.log(`[${tag}] ${message}`);
}

export function warn(tag: string, message: string): void {
  console.warn(`[${tag}] warning: ${message}`);
}

export function error(tag: string, message: string): void {
  console.error(`[${tag}] error: ${message}`);
}

export function success(tag: string, message: string): void {
  console.log(`[${tag}] ${message}`);
}

/** Pretty-print a small table of counts, e.g. { frames: 12, portraits: 36 }. */
export function logCounts(tag: string, counts: Record<string, number>): void {
  for (const [key, value] of Object.entries(counts)) {
    console.log(`[${tag}]   ${key}: ${value}`);
  }
}
