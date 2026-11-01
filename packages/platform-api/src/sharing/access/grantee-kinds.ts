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
// PERSISTENCE (migration 0037_open_sharing_vocabularies). `grants.grantee_kind`
// is text and `grants.grantee_ref` holds the reference of an app kind, so a kind
// registered with `persisted: true` stores its grants: `POST /api/grants`
// validates the grantee with the kind's `validateGrantee`, writes the kind and
// the NORMALISED reference it returned (`grantee_ref`, the built-in grantee
// columns stay NULL, `grants_grantee_consistency_check` is the database's
// second line of defence), and the decision query and the list compose the
// kind's `principalWhere` / `resolvePrincipalMatch`. A kind registered without
// `persisted` is still listed, validated and described, and its fragments are
// checked by the kit, but no grant row carries it (422
// `GRANTEE_KIND_NOT_PERSISTABLE`).
//
// A grant whose kind is no longer registered contributes to nothing (no
// decision, no list) and shows without a description: a row outlives the
// registry that wrote it, and an unregistered kind names nobody.
//
// SECURITY. A fragment is a predicate, never a statement: every value goes
// through the app's SQL kit as a bind parameter (`sql` template) and the grants
// row's columns arrive as ready-made expressions (`GranteeColumns`). The
// composing code wraps the fragments in the ONE `EXISTS` on `grants` whose
// `g.org_id = <the caller's organization>` predicate confines the GRANTS ROW to
// the caller's organization. That is all the slice can guarantee: a fragment
// that reads ANOTHER table (a sub-select over a team table) is not confined by
// it. Such a table must be reached through row-level security or by binding
// `principal.activeOrgId` in the sub-select; `describeGranteeKindConformance`
// checks that a sub-select binds the (distinct) organization value, not that
// it is bound correctly.
//
// Identity. `matchesPrincipal` of a kind that reads `principal.email` trusts
// that the address was verified by the identity provider.
// =============================================================================

import { GRANTEE_KIND_ID_PATTERN, GRANTEE_KIND_INPUTS, type GranteeKindDescriptor, type GranteeKindInput } from '@marinoscar/platform-contract/sharing';

import { defineRegistry, type GroupMembership, type Principal } from '../../core/index';
import { activeGroupsOf } from '../ownership';
import type { SqlKit } from './accessible';

/**
 * Whether the storage layer can hold a grant of a non-built-in kind: always
 * `true` since migration `0037_open_sharing_vocabularies` (`grants.grantee_kind`
 * is text, `grants.grantee_ref` holds the reference). Kept so code written
 * against the earlier "not yet" state keeps compiling.
 *
 * @deprecated Persistence is available; register a kind with `persisted: true`.
 *
 * @stability experimental
 */
export const GRANTEE_KIND_PERSISTENCE_AVAILABLE: boolean = true;

/**
 * The ids the platform's own kinds use. They are registered at import time.
 *
 * @stability experimental
 */
export const BUILTIN_GRANTEE_KIND_IDS: readonly string[] = ['user', 'group', 'link'];

/** Ids no kind may take: the wire discriminator of an app kind. */
const RESERVED_KIND_IDS: readonly string[] = ['custom'];

/**
 * The `via` values the platform's own sources use. A kind may not declare one
 * for itself (the built-in kinds declare their own, and only their own).
 */
const PLATFORM_VIAS: readonly string[] = ['owner', 'group_owner', 'user_grant', 'group_grant', 'org_default', 'bypass', 'none', 'app'];

/** A kind `via`: snake_case WITH an underscore, so it can never equal an access rule id (rule ids are hyphenated). */
const KIND_VIA = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

/**
 * Thrown by {@link GranteeKindDef.validateGrantee} for an input it rejects.
 * Its message is shown to the caller (422 `GRANTEE_INVALID`), so write it for
 * a person; any OTHER error a kind throws is answered with a generic message,
 * so an internal error (a database message, a stack) never reaches the caller.
 *
 * @stability experimental
 */
export class GranteeInputError extends Error {
  /** @param message - what is wrong with the grantee, safe to show. */
  constructor(message: string) {
    super(message);
    this.name = 'GranteeInputError';
  }
}

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
 * How a grantee reads in a list or an audit line.
 *
 * @stability experimental
 */
export interface GranteeDescription {
  /** A short human-readable name, such as "Anyone at the example.com domain". */
  readonly display: string;
}

/**
 * What a stored grant says about its grantee: the kind and the columns that
 * identify it. `ref` is the reference of an app kind (`grants.grantee_ref`, as
 * `validateGrantee` normalised it); built-in kinds use `userId` and `groupId`.
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
  /** The reference of an app kind (`grants.grantee_ref`), or `null`. */
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
   * an app kind opts in (it then needs `principalWhere`, and its grants store
   * the reference `validateGrantee` returned in `grantee_ref`). Default `false`.
   */
  readonly persisted?: boolean;
  /**
   * What `AccessDecision.via` (and the decision metric's `via` group) reports
   * when a grant of this kind allowed an access. Default `<kind>_grant` with
   * hyphens as underscores.
   */
  readonly via?: string;
  /**
   * Checks a grantee the caller submitted and returns it normalised. Throws a
   * {@link GranteeInputError} (whose message is shown) for a rejected input.
   * Synchronous or asynchronous (it may look the grantee up, read only).
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
  describe(ref: GranteeRef): Promise<GranteeDescription>;
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
   * The Prisma `where` spelling of the same predicate, over `Grant` rows (the
   * fields `granteeKind`, `granteeUserId`, `granteeGroupId`, `granteeRef`), for
   * the decision query and the bounded id list. Required with `persisted`;
   * `null` when no grant can name this principal. It must pin
   * `granteeKind: <this kind>` (the conformance kit checks it); the caller
   * confines the whole query to the caller's organization.
   *
   * @param principal - the caller, enriched with its groups.
   */
  principalWhere?(principal: Principal): Record<string, unknown> | null;
}

function check(condition: unknown, kind: string, why: string): asserts condition {
  if (!condition) throw new Error(`grantee kind "${kind}": ${why}`);
}

function validateKind(def: GranteeKindDef, registry: { list(): GranteeKindDef[] }): void {
  const kind = typeof def?.kind === 'string' ? def.kind : '?';
  check(!RESERVED_KIND_IDS.includes(kind), kind, `"${kind}" is reserved (it is the wire discriminator of an app kind)`);
  check(typeof def.label === 'string' && def.label.trim().length > 0, kind, '`label` must be a non-empty string');
  check(def.description === undefined || typeof def.description === 'string', kind, '`description` must be a string');
  check((GRANTEE_KIND_INPUTS as readonly string[]).includes(def.input), kind, `\`input\` must be one of ${GRANTEE_KIND_INPUTS.join(', ')}`);
  check(def.via === undefined || (typeof def.via === 'string' && KIND_VIA.test(def.via)), kind, '`via` must be lower-case snake_case with an underscore (for example `team_grant`)');
  const via = def.via ?? `${kind.replace(/-/g, '_')}_grant`;
  const builtin = BUILTIN_GRANTEE_KIND_IDS.includes(kind);
  check(!PLATFORM_VIAS.includes(via) || (builtin && via === `${kind}_grant`), kind, `\`via\` "${via}" is one of the platform's own (${PLATFORM_VIAS.join(', ')})`);
  check(!registry.list().some((other) => other.kind !== kind && granteeKindVia(other) === via), kind, `\`via\` "${via}" is already used by another grantee kind`);
  for (const member of ['validateGrantee', 'describe', 'matchesPrincipal', 'resolvePrincipalMatch'] as const) {
    check(typeof def[member] === 'function', kind, `\`${member}\` must be a function`);
  }
  check(def.principalWhere === undefined || typeof def.principalWhere === 'function', kind, '`principalWhere` must be a function');
  if (def.persisted === true) {
    check(typeof def.principalWhere === 'function', kind, '`persisted` needs `principalWhere` (the Prisma spelling of the predicate)');
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
  validate: (def, registry) => validateKind(def, registry),
});

/**
 * Registers one grantee kind. Call it at import time, before the application
 * bootstraps (an app's `app-registrations` module); register kinds before the
 * resource types that list roles for them.
 *
 * @param def - the grantee kind (the object is shallow-frozen).
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
  // Shallow-frozen: a registered definition is the app's decision at start-up, not a live object
  // that code holding a reference can change later (this freezes the object you pass).
  granteeKindRegistry.register(Object.freeze(def));
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
 * The Prisma `where` over `Grant` rows that names `principal` through `def`,
 * pinned to the kind (an app kind; the built-ins pin their own): `{ AND: [{ granteeKind }, def.principalWhere(...)] }`. The
 * pin is the platform's, not the kind's, so a kind whose `where` is too broad
 * (empty, a bare `OR`) still cannot match another kind's rows. `null` when the
 * kind names nobody; a kind that throws names nobody (fail closed).
 *
 * @param def - a persisted kind.
 * @param principal - the caller, enriched with its groups.
 *
 * @stability experimental
 */
export function granteeWhereFor(def: GranteeKindDef, principal: Principal): Record<string, unknown> | null {
  try {
    const where = def.principalWhere?.(principal) ?? null;
    // The built-ins are the platform's own and already pin their kind; an app kind is pinned here.
    return where === null || BUILTIN_GRANTEE_KIND_IDS.includes(def.kind) ? where : { AND: [{ granteeKind: def.kind }, where] };
  } catch {
    return null;
  }
}

/**
 * The SQL condition over a grants row that names `principal` through `def`,
 * pinned to the kind for an app kind (`kind = '<id>' AND (<the kind's fragment>)`, the id a bind
 * parameter), for the same reason as {@link granteeWhereFor}. `null` when the
 * kind names nobody; a kind that throws names nobody.
 *
 * @param def - a persisted kind.
 * @param principal - the caller, enriched with its groups.
 * @param columns - the grantee columns of the row.
 * @param kit - the app's SQL builders.
 *
 * @stability experimental
 */
export function granteeSqlFor<S>(def: GranteeKindDef, principal: Principal, columns: GranteeColumns<S>, kit: SqlKit<S>): S | null {
  try {
    const fragment = def.resolvePrincipalMatch<S>(principal, columns, kit);
    return fragment === null || BUILTIN_GRANTEE_KIND_IDS.includes(def.kind) ? fragment : kit.sql`(${columns.kind} = ${def.kind} AND (${fragment}))`;
  } catch {
    return null;
  }
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
    throw new GranteeInputError('A person is named by a user id or an e-mail address.');
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
    throw new GranteeInputError('A group is named by its id.');
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
    throw new GranteeInputError('A link is created through POST /api/grants/links, not as a grantee.');
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
