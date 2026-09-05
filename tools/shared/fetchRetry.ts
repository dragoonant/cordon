/**
 * CORDON build tools — fetch with timeout, retry and backoff.
 *
 * Uses the platform `fetch` (Node 24 has it globally; no dependency needed).
 * Auth failures (401/403 by default) never retry — the caller should treat
 * `AuthError` as fatal and stop the whole run, per the pipeline specs (an
 * expired/invalid key should not burn through retry budget silently).
 */

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export interface RetryInfo {
  attempt: number; // 0-based attempt number that just finished
  status?: number;
  error?: unknown;
  delayMs: number;
}

export interface RetryOptions {
  /** Retries *after* the first attempt. Default 3 (so up to 4 total tries). */
  retries?: number;
  /** Per-attempt timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Base delay for exponential backoff (ms). Default 500. */
  baseDelayMs?: number;
  /** Response statuses that trigger a retry. Default [429, 500, 502, 503, 504]. */
  retryStatuses?: number[];
  /** Response statuses that fail immediately, no retry. Default [401, 403]. */
  authStatuses?: number[];
  onRetry?: (info: RetryInfo) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Honors a numeric (seconds) Retry-After header if present, else exponential backoff with jitter. */
function delayForAttempt(res: Response | undefined, attempt: number, baseDelayMs: number): number {
  const retryAfter = res?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  const exp = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(exp * 0.2 * Math.random());
  return exp + jitter;
}

/**
 * fetch() with a timeout, retry-with-backoff on transient statuses/errors,
 * and immediate failure on auth statuses. Resolves to the raw Response for
 * any non-retried status (including 4xx/5xx the caller wants to inspect
 * itself) — it does not throw on non-2xx unless it's an auth status.
 */
export async function fetchRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {}
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const retryStatuses = opts.retryStatuses ?? [429, 500, 502, 503, 504];
  const authStatuses = opts.authStatuses ?? [401, 403];

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (authStatuses.includes(res.status)) {
        throw new AuthError(`authentication failed (HTTP ${res.status}) for ${new URL(url).pathname}`, res.status);
      }

      if (retryStatuses.includes(res.status) && attempt < retries) {
        const delayMs = delayForAttempt(res, attempt, baseDelayMs);
        opts.onRetry?.({ attempt, status: res.status, delayMs });
        await sleep(delayMs);
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof AuthError) throw err;
      lastError = err;
      if (attempt >= retries) throw err;
      const delayMs = delayForAttempt(undefined, attempt, baseDelayMs);
      opts.onRetry?.({ attempt, error: err, delayMs });
      await sleep(delayMs);
    }
  }
  throw lastError ?? new Error(`fetchRetry: exhausted retries for ${url}`);
}

export { sleep };
