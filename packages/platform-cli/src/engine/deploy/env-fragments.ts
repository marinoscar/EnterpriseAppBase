import { parseEnvExample, type EnvVarSpec } from './env-spec.js';

// =============================================================================
// The env template, as fragments  (PP-8.10 #714, PP-8.9 #715)
// =============================================================================
//
// `infra/compose/.env.example` is the deploy wizard's and `init`'s question
// list, and it is composed by `platform-infra sync` from fragments, in this
// order: the platform base (`@marinoscar/platform-infra/env/base.env.example`),
// each enabled slice's variables, then the app's own
// `infra/compose/app.env.example`. `init` and `deploy` read the composed
// file (a VPS deploy runs from the cloned repository, which has it and need
// not have node_modules); `composeEnvSpecs` is the same composition over the
// fragments' text, which is how a test proves the two agree.
//
// ⚠ A COMMENTED `# KEY=value` LINE IS A DECLARATION. `parseEnvExample` reads
// one as an optional variable, so an illustrative assignment in a comment
// becomes a question the wizard asks. The platform base keeps the optional
// keys it has always documented (`PLATFORM_DOCUMENTED_OPTIONAL_KEYS`); every
// other fragment has none, and `commentedAssignments` is the check.
// =============================================================================

/**
 * The commented-out (optional) keys the platform's base template documents on
 * purpose. No other fragment may declare one.
 *
 * @stability experimental
 */
export const PLATFORM_DOCUMENTED_OPTIONAL_KEYS: readonly string[] = Object.freeze([
  'CORS_ORIGIN',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_CALLBACK_URL',
  'TEST_AUTH_ENABLED',
  'MAINTENANCE_MODE',
  'OTEL_DEBUG',
  'JOBS_SYSTEM_MODE_EXTRA_TYPES',
]);

/**
 * The keys a template declares through a commented `# KEY=value` line, in
 * file order.
 *
 * @param text - A `.env.example` fragment.
 * @param allowed - Keys the fragment documents on purpose (the platform base's).
 * @returns The offending keys; empty when the fragment is clean.
 * @stability experimental
 */
export function commentedAssignments(text: string, allowed: readonly string[] = []): string[] {
  return parseEnvExample(text)
    .filter((spec) => spec.optional && !allowed.includes(spec.key))
    .map((spec) => spec.key);
}

/**
 * Parses env template fragments in order, as `platform-infra sync` composes
 * them into `.env.example`.
 *
 * @param fragments - The fragments' text: platform base, slices, then the app's.
 * @returns The specs in composed order.
 * @throws Error when two fragments declare the same key.
 * @stability experimental
 */
export function composeEnvSpecs(fragments: readonly string[]): EnvVarSpec[] {
  const specs: EnvVarSpec[] = [];
  const seen = new Set<string>();
  for (const text of fragments) {
    for (const spec of parseEnvExample(text)) {
      if (seen.has(spec.key)) throw new Error(`Env key "${spec.key}" is declared by two env template fragments.`);
      seen.add(spec.key);
      specs.push(spec);
    }
  }
  return specs;
}
