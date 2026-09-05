/**
 * CORDON build tools — secret loading.
 *
 * Per CONVENTIONS.md "Secrets": `.hf_token` and `.elevenlabs_key` live in the
 * repo root, are gitignored, and are read ONLY from tools/ scripts at build
 * time. Never import this from src/, never log the returned value, and never
 * write it anywhere else. Callers should report presence with
 * `key present: yes/no` — never the value itself, and never the raw error
 * text from a failed read (which could echo file contents in some runtimes).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** tools/shared -> repo root */
export const REPO_ROOT = path.resolve(HERE, '../..');

export type SecretName = 'elevenlabs' | 'hf';

const SECRET_FILES: Record<SecretName, string> = {
  elevenlabs: '.elevenlabs_key',
  hf: '.hf_token',
};

const SECRET_ENV_VARS: Record<SecretName, string> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  hf: 'HF_TOKEN',
};

/**
 * Reads a secret by logical name. Order: env var override, then the repo-root
 * dotfile (trimmed of whitespace/newlines). Returns null if neither is set.
 * Never throws on a missing file — a missing key is an expected, reportable
 * state, not an error.
 */
export function readSecret(name: SecretName, rootDir: string = REPO_ROOT): string | null {
  const envVar = SECRET_ENV_VARS[name];
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  const filePath = path.join(rootDir, SECRET_FILES[name]);
  try {
    const raw = readFileSync(filePath, 'utf8');
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** Safe-to-log presence check, e.g. `key present: yes`. Never logs the value. */
export function describeSecretPresence(name: SecretName, rootDir: string = REPO_ROOT): string {
  return `key present: ${readSecret(name, rootDir) ? 'yes' : 'no'}`;
}
