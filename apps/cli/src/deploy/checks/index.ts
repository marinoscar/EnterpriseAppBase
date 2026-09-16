import type { Check } from './types.js';
import { DATABASE_CHECKS } from './database.js';
import { DNS_CHECKS } from './dns.js';
import { GH_CHECKS } from './gh.js';
import { HOST_CHECKS } from './host.js';
import { TLS_CHECKS } from './tls.js';

// =============================================================================
// The check registry  (issue #176, epic #168)
// =============================================================================
//
// ONE ordered list. `doctor` renders it (#178), and install and update run the
// `required` subset as their preflight (#180, #182) - from here, not from a
// second list of their own. Two lists is how a prerequisite ends up enforced
// by one command and not the other.
// =============================================================================

// Host first: everything else depends on docker being usable, and a server
// with no docker should say so before it starts probing databases.
export const ALL_CHECKS: readonly Check[] = [
  ...HOST_CHECKS,
  // The repository's own prerequisites (#390) sit between the host and the
  // database: they are about tooling, like the host group, but only one of
  // them is ever a blocker and putting them first would give a wall of advice
  // before the checks that actually gate an install.
  ...GH_CHECKS,
  ...DATABASE_CHECKS,
  ...DNS_CHECKS,
  ...TLS_CHECKS,
];

/** The subset install and update must pass before they touch anything. */
export function requiredChecks(checks: readonly Check[] = ALL_CHECKS): Check[] {
  return checks.filter((check) => check.severity === 'required');
}

export * from './types.js';
export { HOST_CHECKS, evaluateDf } from './host.js';
export { DATABASE_CHECKS, databaseSettings, probeTcp, psql } from './database.js';
export type { DatabaseSettings, PsqlContext } from './database.js';
export { DNS_CHECKS } from './dns.js';
export { GH_CHECKS, assessCredentialNeed, prepareGitCredentials } from './gh.js';
export type {
  CredentialNeed,
  CredentialProbeContext,
  CredentialSetup,
  PrepareCredentialsOptions,
} from './gh.js';
export {
  RENEWAL_SCRIPT_PATHS,
  TLS_CHECKS,
  compareServedCertificate,
  extractPem,
  findRenewalOwner,
  parseNotAfter,
} from './tls.js';
export type { RenewalMechanism, RenewalOwner, RenewalProbeContext } from './tls.js';
