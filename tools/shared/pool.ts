/**
 * CORDON build tools — tiny bounded-concurrency runner.
 *
 * Used by both pipelines to throttle concurrent API calls (spec: concurrency
 * 2 for both ElevenLabs and Hugging Face). Not a queue library — just enough
 * to avoid firing all requests at once.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    await worker(items[i], i);
    return next();
  }
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => next()));
}
