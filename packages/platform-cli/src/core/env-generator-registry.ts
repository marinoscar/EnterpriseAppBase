import { randomBytes } from 'node:crypto';

import { createCliRegistry } from './cli-registry.js';

// =============================================================================
// Env value generators  (PP-14.22)
// =============================================================================
//
// `EnvVarMetadata.generate` names HOW a value is made when the deploy wizard
// offers to generate one (or `autoGenerate` makes it unasked): `base64-32` and
// `hex-32` were the only two. A generator is now a registered kind, so an app
// whose key has its own shape (a Greptime-style `user=password` token, a
// 24-character URL-safe id) registers the kind and names it in its fragment.
//
// A GENERATOR IS A SYNCHRONOUS FUNCTION RETURNING A STRING, NOT A COMMAND.
// There is no way to register `openssl rand ...` or any argv/shell string: the
// package never spawns anything on a generator's behalf, so a registration
// cannot become shell execution through this API. (The function is app code
// like any other registration; the guarantee is that the platform adds no
// execution surface of its own.) What a generator returns is validated before
// it is used, because the value is written into a `.env` file read by Compose:
// printable characters from a safe set only, no whitespace, quotes, `$` or `#`.
// =============================================================================

/**
 * A way to make a value.
 *
 * @stability experimental
 */
export interface EnvGeneratorRegistration {
  /** Lowercase letters, digits and hyphens: what `EnvVarMetadata.generate` names. */
  kind: string;
  /** Returns a fresh value. Synchronous; draw randomness from `node:crypto`, never `Math.random`. */
  generate(): string;
}

const KIND_PATTERN = /^[a-z][a-z0-9-]*$/;
/** What a generated value may contain: it lands in a `.env` file and in Compose interpolation. */
const SAFE_VALUE = /^[A-Za-z0-9+/=_.:@-]{1,512}$/;

const BUILTIN: readonly EnvGeneratorRegistration[] = Object.freeze([
  {
    kind: 'base64-32',
    // 32 random bytes, standard base64 (AES-256 keys, JWT secrets).
    generate: () => randomBytes(32).toString('base64'),
  },
  {
    kind: 'hex-32',
    // 32 random bytes as lowercase hex: for syntaxes that reserve base64's characters.
    generate: () => randomBytes(32).toString('hex'),
  },
]);

const registry = createCliRegistry<EnvGeneratorRegistration>({
  name: 'env generator',
  registerFn: 'registerEnvGenerator',
  idOf: (generator) => generator.kind,
  validate: (generator) => {
    if (typeof generator?.kind !== 'string' || !KIND_PATTERN.test(generator.kind)) {
      throw new Error(`Env generator kind ${JSON.stringify(generator?.kind)} is invalid: use lowercase letters, digits and hyphens.`);
    }
    if (typeof generator.generate !== 'function') {
      throw new Error(`Env generator "${generator.kind}" needs a generate function returning a string.`);
    }
  },
});
for (const generator of BUILTIN) registry.register(generator);

/**
 * Registers a kind of generated value for `EnvVarMetadata.generate`.
 *
 * @param generator - The kind and a synchronous function returning a fresh value.
 * @throws Error on a malformed or taken kind (the built-ins `base64-32` and
 *   `hex-32` included), or after `createCli` built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerEnvGenerator({ kind: 'token-24', generate: () => randomBytes(18).toString('base64url') });
 * registerEnvSpecFragment({ id: 'coach', metadata: { COACH_TOKEN: { secret: true, generate: 'token-24' } } });
 * ```
 */
export function registerEnvGenerator(generator: EnvGeneratorRegistration): void {
  registry.register(Object.freeze({ kind: generator.kind, generate: generator.generate }));
}

/**
 * The registered generator kinds, the built-ins first.
 *
 * @returns A frozen copy.
 * @stability experimental
 */
export function listEnvGenerators(): readonly EnvGeneratorRegistration[] {
  return registry.list();
}

/**
 * Makes a value with a registered kind, and checks what came back.
 *
 * @param kind - A registered kind.
 * @returns The generated value.
 * @throws Error when the kind is unknown (naming the registered ones), or the
 *   generator returned something that is not a plain value of the safe set.
 * @stability experimental
 */
export function generateWithKind(kind: string): string {
  const generator = registry.get(kind);
  if (generator === undefined) {
    throw new Error(
      `Unknown env generator kind "${kind}". Registered: ${registry.list().map((entry) => entry.kind).join(', ')}. ` +
        'Register it with registerEnvGenerator (before createCli).',
    );
  }
  const value = generator.generate();
  if (typeof value !== 'string' || !SAFE_VALUE.test(value)) {
    throw new Error(
      `Env generator "${kind}" returned a value that cannot be written to a .env file: ` +
        'use 1 to 512 characters from letters, digits and + / = _ . : @ - only.',
    );
  }
  return value;
}

/**
 * Refuses later registrations; `createCli` calls it.
 *
 * @param by - Who froze it, named in the error a late registration gets.
 * @internal
 * @stability experimental
 */
export function freezeEnvGeneratorRegistry(by: string): void {
  registry.freeze(by);
}

/**
 * Restores the built-ins only and unfreezes. Tests only.
 *
 * @internal
 * @stability experimental
 */
export function resetEnvGeneratorRegistryForTests(): void {
  registry.reset();
  for (const generator of BUILTIN) registry.register(generator);
}
