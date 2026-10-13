// =============================================================================
// The grantee-kind registry (PP-14.16): rung 2 of the extension contract
// =============================================================================
//
// A GRANTEE KIND is a way to name who a grant shares a record with. The
// platform ships three: `user`, `group` and `link`. They register through
// `registerGranteeKind` exactly as an app's kind does (no private fast path),
// and everything that used to hard-code them composes the registered kinds:
//
//   - `AccessPolicy` loads the caller's candidate grants with each persisted
//     kind's `principalWhere`, then asks `matchesPrincipal` per grant;
//   - `accessibleWhere` / `accessibleSql` ("resources I can see") join each
//     persisted kind's `resolvePrincipalMatch` fragment with OR;
//   - `GET /api/sharing/grantee-kinds` serves the descriptors a share dialog
//     lists;
//   - `POST /api/grants` runs `validateGrantee` for a grantee of an app kind.
//
// THE TWO REPRESENTATIONS OF "WHO THIS GRANT NAMES" MUST AGREE: `matchesPrincipal`
// (the in-memory decision) and `resolvePrincipalMatch` (the SQL fragment of the
// list) are two spellings of one predicate over a grant's grantee columns.
// `describeGranteeKindConformance` (./testing) compares them over a fixture
// matrix, so a drift between "may I open it" and "does it list" fails a test.
//
// PERSISTENCE. A `grants` row can store only the built-in kinds today: the
// `grantee_kind` column is an enum and a check constraint binds the grantee
// columns to it. A kind registered with `persisted: true` that is not built in
// is therefore REFUSED at registration (`GRANTEE_KIND_PERSISTENCE_AVAILABLE`
// flips when the storage migration ships). A kind registered without
// `persisted` is still listed, validated and described, and its fragments are
// checked by the kit, but no grant row carries it.
//
// SECURITY. A fragment is a predicate, never a statement: every value goes
// through the app's SQL kit as a bind parameter (`sql` template), the grants
// row's columns arrive as ready-made expressions (`GranteeColumns`) and the
// composing code wraps the result in `g.org_id = <the caller's organization>`,
// so a fragment cannot reach another organization's rows. A fragment that
// needs a sub-select (a team table) must bind `principal.activeOrgId` in it.
// =============================================================================

import { GRANTEE_KIND_ID_PATTERN, GRANTEE_KIND_INPUTS, type GranteeKindDescriptor, type GranteeKindInput } from '@marinoscar/platform-contract/sharing';

import { defineRegistry, type GroupMembership, type Principal } from '../../core/index';
import { activeGroupsOf } from '../ownership';
import type { SqlKit } from './accessible';

/**
 * Whether the storage layer can hold a grant of a non-built-in kind. `false`
 * until the sharing migration that turns `grants.grantee_kind` into text and
 * adds the grantee reference column ships; `registerGranteeKind` then refuses
 * `persisted: true` for an app kind.
 *
 * @stability experimental
 */
export const GRANTEE_KIND_PERSISTENCE_AVAILABLE: boolean = false;

/**
 * The ids the platform's own kinds use. They are registered at import time.
 *
 * @stability experimental
 */
export const BUILTIN_GRANTEE_KIND_IDS: readonly string[] = ['user', 'group', 'link'];

/** Ids no kind may take: the wire discriminator of an app kind. */
const RESERVED_KIND_IDS: readonly string[] = ['custom'];

/**
 * Who a grant names, as a kind validates and describes it: the kind and an
 * opaque reference (a user id, a group id, a domain, a team id).
 *
 * @stability experimental
 */
export interface GranteeRef {
  /** The registered kind. */
  readonly kind: string;
  /** The grantee within the kind. */
  readonly id: string;
}

/**
 * What a stored grant says about its grantee: the kind and the columns that
 * identify it. `ref` is the reference of an app kind (the column the storage
 * migration adds); built-in kinds use `userId` and `groupId`.
 *
 * @stability experimental
 */
export interface GranteeFacts {
  /** The grant's `grantee_kind`. */
  readonly kind: string;
  /** `grantee_user_id`, or `null`. */
  readonly userId: string | null;
  /** `grantee_group_id`, or `null`. */
  readonly groupId: string | null;
  /** The reference of an app kind, or `null`. */
  readonly ref: string | null;
}

/**
 * The grantee columns of the grants row a fragment is a predicate over, as SQL
 * expressions of the app's SQL kit (`g.grantee_kind`, ... in the list query;
 * bound fixture values in the conformance kit).
 *
 * @typeParam S - the app's `Prisma.Sql`.
 *
 * @stability experimental
 */
export interface GranteeColumns<S> {
  /** The kind (text compared against a literal). */
  readonly kind: S;
  /** The user grantee (uuid). */
  readonly userId: S;
  /** The group grantee (uuid). */
  readonly groupId: S;
  /** The reference of an app kind (text). */
  readonly ref: S;
}

/**
 * One grantee kind.
 *
 * @example
 * ```ts
 * registerGranteeKind({
 *   kind: 'email-domain',
 *   label: 'Email domain',
 *   input: 'text',
 *   validateGrantee: (input) => ({ kind: 'email-domain', id: normaliseDomain(input) }),
 *   describe: async (ref) => ({ display: `Anyone at @${ref.id}` }),
 *   matchesPrincipal: (facts, principal) => facts.ref === domainOf(principal.email),
 *   resolvePrincipalMatch: (principal, g, kit) =>
 *     kit.sql`(${g.kind} = 'email-domain' AND lower(${g.ref}) = ${domainOf(principal.email)})`,
 * });
 * ```
 *
 * @stability experimental
 */
export interface GranteeKindDef {
  /** Stable id (`GRANTEE_KIND_ID_PATTERN`): lower-case letters, digits and hyphens. Permanent once grants of it exist. */
  readonly kind: string;
  /** The label a share dialog shows ("Email domain"). */
  readonly label: string;
  /** A sentence about who the kind shares with. */
  readonly description?: string;
  /** How a share dialog collects the grantee. */
  readonly input: GranteeKindInput;
  /**
   * Whether grants of this kind are rows of the `grants` table. Built-ins are;
   * an app kind may not be until the storage migration ships
   * ({@link GRANTEE_KIND_PERSISTENCE_AVAILABLE}). Default `false`.
   */
  readonly persisted?: boolean;
  /**
   * What `AccessDecision.via` (and the decision metric's `via` group) reports
   * when a grant of this kind allowed an access. Default `<kind>_grant` with
   * hyphens as underscores.
   */
  readonly via?: string;
  /**
   * Checks a grantee the caller submitted and returns it normalised. Throws
   * an `Error` whose message is safe to show on a rejected input. Synchronous
   * or asynchronous (it may look the grantee up).
   *
   * @param input - the submitted grantee (`ref` of the wire shape, or the built-in shape).
   */
  validateGrantee(input: unknown): GranteeRef | Promise<GranteeRef>;
  /**
   * A display string for a grantee, for lists and audit lines. It must not
   * throw for a reference whose target was deleted.
   *
   * @param ref - the grantee.
   */
  describe(ref: GranteeRef): Promise<{ display: string }>;
  /**
   * The in-memory spelling of the predicate: whether a stored grantee names
   * `principal`. Must equal {@link GranteeKindDef.resolvePrincipalMatch}.
   *
   * @param facts - the grant's grantee columns.
   * @param principal - the caller, enriched with its groups.
   */
  matchesPrincipal(facts: GranteeFacts, principal: Principal): boolean;
  /**
   * The SQL spelling of the predicate over the grants row: a condition built
   * with the app's SQL kit, or `null` when no grant of this kind can name
   * this principal. Every value is a bind parameter; never interpolate input.
   *
   * @param principal - the caller, enriched with its groups.
   * @param columns - the grantee columns of the row.
   * @param kit - the app's SQL builders.
   */
  resolvePrincipalMatch<S>(principal: Principal, columns: GranteeColumns<S>, kit: SqlKit<S>): S | null;
  /**
   * The Prisma `where` spelling of the same predicate, over `Grant` rows, for
   * the decision query and the bounded id list. Required with `persisted`;
   * `null` when no grant can name this principal.
   *
   * @param principal - the caller, enriched with its groups.
   */
  principalWhere?(principal: Principal): Record<string, unknown> | null;
}

function check(condition: unknown, kind: string, why: string): asserts condition {
  if (!condition) throw new Error(`grantee kind "${kind}": ${why}`);
}

function validateKind(def: GranteeKindDef): void {
  const kind = typeof def?.kind === 'string' ? def.kind : '?';
  check(!RESERVED_KIND_IDS.includes(kind), kind, `"${kind}" is reserved (it is the wire discriminator of an app kind)`);
  check(typeof def.label === 'string' && def.label.trim().length > 0, kind, '`label` must be a non-empty string');
  check(def.description === undefined || typeof def.description === 'string', kind, '`description` must be a string');
  check((GRANTEE_KIND_INPUTS as readonly string[]).includes(def.input), kind, `\`input\` must be one of ${GRANTEE_KIND_INPUTS.join(', ')}`);
  check(def.via === undefined || /^[a-z][a-z0-9_]*$/.test(def.via), kind, '`via` must be lower-case snake_case');
  for (const member of ['validateGrantee', 'describe', 'matchesPrincipal', 'resolvePrincipalMatch'] as const) {
    check(typeof def[member] === 'function', kind, `\`${member}\` must be a function`);
  }
  check(def.principalWhere === undefined || typeof def.principalWhere === 'function', kind, '`principalWhere` must be a function');
  if (def.persisted === true) {
    check(typeof def.principalWhere === 'function', kind, '`persisted` needs `principalWhere` (the Prisma spelling of the predicate)');
    if (!BUILTIN_GRANTEE_KIND_IDS.includes(kind)) {
      check(
        GRANTEE_KIND_PERSISTENCE_AVAILABLE,
        kind,
        'grants of an app kind cannot be stored yet: the `grants.grantee_kind` column is an enum until the sharing storage migration ships. ' +
          'Register the kind without `persisted` for now (it is listed, validated and conformance-checked, but no grant row carries it).',
      );
    }
  }
}

/**
 * The grantee kinds. String ids, a duplicate-id error, registration order,
 * frozen after bootstrap (the core registry primitive). `user`, `group` and
 * `link` are registered when the sharing slice is imported.
 *
 * @stability experimental
 */
export const granteeKindRegistry = defineRegistry<GranteeKindDef>({
  name: 'sharing-grantee-kinds',
  idOf: (def) => def.kind,
  idPattern: GRANTEE_KIND_ID_PATTERN,
  validate: (def) => validateKind(def),
});

/**
 * Registers one grantee kind. Call it at import time, before the application
 * bootstraps (an app's `app-registrations` module); register kinds before the
 * resource types that list roles for them.
 *
 * @param def - the grantee kind.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY` (the message names the
 *   kind and the rule), `DUPLICATE_ID` or `FROZEN` (after bootstrap).
 *
 * @example
 * ```ts
 * registerGranteeKind(emailDomainGranteeKind); // apps/api/src/platform-extensions/sharing/email-domain.grantee-kind.ts
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerGranteeKind(def: GranteeKindDef): void {
  granteeKindRegistry.register(def);
}

/**
 * The registered kind `kind`, or `undefined`.
 *
 * @param kind - a grantee kind id.
 *
 * @stability experimental
 */
export function findGranteeKind(kind: string): GranteeKindDef | undefined {
  return granteeKindRegistry.get(kind);
}

/**
 * The kinds whose grants are rows of the `grants` table, in registration
 * order: what the decision query and the list SQL compose.
 *
 * @stability experimental
 */
export function persistedGranteeKinds(): GranteeKindDef[] {
  return granteeKindRegistry.list().filter((def) => def.persisted === true);
}

/**
 * What `AccessDecision.via` reports for a grant of `def`.
 *
 * @param def - the kind.
 *
 * @stability experimental
 */
export function granteeKindVia(def: GranteeKindDef): string {
  return def.via ?? `${def.kind.replace(/-/g, '_')}_grant`;
}

/**
 * The descriptor `GET /api/sharing/grantee-kinds` serves for `def`.
 *
 * @param def - the kind.
 *
 * @stability experimental
 */
export function describeGranteeKind(def: GranteeKindDef): GranteeKindDescriptor {
  return {
    kind: def.kind,
    label: def.label,
    description: def.description ?? null,
    input: def.input,
    builtin: BUILTIN_GRANTEE_KIND_IDS.includes(def.kind),
    persisted: def.persisted === true,
  };
}

/** The principal an evaluation matches against: carries the groups the caller enriched. */
export function withGroups(principal: Principal, groups: readonly GroupMembership[]): Principal {
  return principal.groups === groups ? principal : { ...principal, groups };
}

// ---- the built-in kinds: registered through the same call --------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fieldOf(input: unknown, name: string): unknown {
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>)[name] : undefined;
}

const userKind: GranteeKindDef = {
  kind: 'user',
  label: 'Person',
  description: 'One member of the organization.',
  input: 'user-search',
  persisted: true,
  via: 'user_grant',
  validateGrantee(input) {
    const userId = fieldOf(input, 'userId');
    if (typeof userId === 'string' && UUID.test(userId)) return { kind: 'user', id: userId.toLowerCase() };
    const email = fieldOf(input, 'email');
    if (typeof email === 'string' && email.includes('@')) return { kind: 'user', id: email.trim().toLowerCase() };
    throw new Error('A person is named by a user id or an e-mail address.');
  },
  async describe(ref) {
    return { display: ref.id };
  },
  matchesPrincipal: (facts, principal) => facts.kind === 'user' && facts.userId !== null && facts.userId === principal.userId,
  resolvePrincipalMatch: (principal, g, kit) => kit.sql`(${g.kind} = 'user' AND ${g.userId} = ${principal.userId}::uuid)`,
  principalWhere: (principal) => ({ granteeKind: 'user', granteeUserId: principal.userId }),
};

function groupIdsOf(principal: Principal): string[] {
  return [...new Set(activeGroupsOf(principal).map((group) => group.groupId))];
}

const groupKind: GranteeKindDef = {
  kind: 'group',
  label: 'Group',
  description: 'Every member of one group of the organization.',
  input: 'group-select',
  persisted: true,
  via: 'group_grant',
  validateGrantee(input) {
    const groupId = fieldOf(input, 'groupId');
    if (typeof groupId === 'string' && UUID.test(groupId)) return { kind: 'group', id: groupId.toLowerCase() };
    throw new Error('A group is named by its id.');
  },
  async describe(ref) {
    return { display: ref.id };
  },
  matchesPrincipal: (facts, principal) => facts.kind === 'group' && facts.groupId !== null && groupIdsOf(principal).includes(facts.groupId),
  resolvePrincipalMatch(principal, g, kit) {
    const ids = groupIdsOf(principal);
    if (ids.length === 0) return null;
    return kit.sql`(${g.kind} = 'group' AND ${g.groupId} IN (${kit.join(ids.map((id) => kit.sql`${id}::uuid`))}))`;
  },
  principalWhere(principal) {
    const ids = groupIdsOf(principal);
    return ids.length === 0 ? null : { granteeKind: 'group', granteeGroupId: { in: ids } };
  },
};

// A link names whoever holds the token, never a principal: it is resolved by
// `LinkGrantsService` from the token, so it contributes to no decision or list.
const linkKind: GranteeKindDef = {
  kind: 'link',
  label: 'Link',
  description: 'Anyone holding the link, without signing in.',
  input: 'none',
  persisted: true,
  via: 'link_grant',
  validateGrantee() {
    throw new Error('A link is created through POST /api/grants/links, not as a grantee.');
  },
  async describe() {
    return { display: 'Anyone with the link' };
  },
  matchesPrincipal: () => false,
  resolvePrincipalMatch: () => null,
  principalWhere: () => null,
};

for (const def of [userKind, groupKind, linkKind]) {
  if (!granteeKindRegistry.has(def.kind)) registerGranteeKind(def);
}
