// Where `platform-infra sync` finds the app identity it renders the infra
// files with. Kept apart from identity.ts so the pure rendering stays free of
// the filesystem.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { deriveInfraIdentity, type InfraIdentity, type InfraIdentityInput } from './identity.js';

/**
 * The identity file read when none is named: the reference app's single
 * identity source (`@app/shared`).
 *
 * @internal
 */
export const DEFAULT_IDENTITY_FILE = 'packages/shared/identity.json';

/** The reference app's CLI manifest; its single `bin` key is the CLI name. */
const CLI_MANIFEST = 'apps/cli/package.json';

const STRING_FIELDS = ['cliName', 'productName', 'envPrefix', 'serviceName', 'workerImage', 'testDatabase', 'testContainer'] as const;

function readJson(path: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`platform-infra: ${path} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** The single `bin` key of the app's CLI manifest, when there is exactly one. */
function cliNameFromBin(root: string): string | undefined {
  const path = join(root, ...CLI_MANIFEST.split('/'));
  if (!existsSync(path)) return undefined;
  const bin = readJson(path).bin;
  if (bin === null || typeof bin !== 'object') return undefined;
  const names = Object.keys(bin);
  return names.length === 1 ? names[0] : undefined;
}

/**
 * Reads the app identity sync renders placeholders with.
 *
 * The identity file (default {@link DEFAULT_IDENTITY_FILE}) may carry any
 * {@link InfraIdentityInput} field; the reference app's carries `productName`
 * only, so the CLI name comes from the single `bin` key of
 * `apps/cli/package.json` (the name `scripts/rename.mjs` renames). A starter
 * app (#741) puts `cliName` in its identity file instead.
 *
 * @param root - The app's repository root.
 * @param identityFile - An identity file relative to `root`, instead of the default.
 * @returns The identity, or `undefined` when the app has no identity file and
 *   no CLI manifest (an app whose files need no rendering).
 * @throws Error when a named identity file is missing, or the identity has no
 *   CLI name or an unusable value.
 * @internal
 */
export function readAppIdentity(root: string, identityFile?: string): InfraIdentity | undefined {
  const file = identityFile ?? DEFAULT_IDENTITY_FILE;
  const path = isAbsolute(file) ? file : resolve(root, ...file.split('/'));
  const fields: Record<string, unknown> = existsSync(path) ? readJson(path) : {};
  if (identityFile !== undefined && !existsSync(path)) {
    throw new Error(`platform-infra: identity file ${file} does not exist`);
  }
  const input: Record<string, string> = {};
  for (const key of STRING_FIELDS) {
    const value = fields[key];
    if (typeof value === 'string' && value !== '') input[key] = value;
  }
  input.cliName ??= cliNameFromBin(root) ?? '';
  if (input.cliName === '') {
    if (!existsSync(path)) return undefined;
    throw new Error(`platform-infra: ${file} has no "cliName", and ${CLI_MANIFEST} has no single bin entry to take it from`);
  }
  return deriveInfraIdentity(input as unknown as InfraIdentityInput);
}
