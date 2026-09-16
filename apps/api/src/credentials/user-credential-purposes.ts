// =============================================================================
// Per-user credential purpose registry (issue #387)
// =============================================================================
//
// ONE declaration of what kinds of personal credential this application knows
// about — the same "one registry entry" shape `notifications/
// notification-events.ts` uses for events and `apps/web/src/config/
// adminSections.tsx` uses for settings cards, applied to bring-your-own-key
// credentials.
//
// A purpose entry answers three questions that would otherwise be answered
// separately, and differently, in three places:
//
//   1. does this deployment even offer a personal key for this thing?
//   2. what do we call it when we show it to the person who owns it?
//   3. when they have not supplied one, whose key gets used instead?
//
// Without a single list, (1) lives in whatever controller accepts the write,
// (2) lives in the React component, and (3) lives in each consumer's own
// if-statement — which is how two consumers of the same purpose end up
// disagreeing about whether there IS a fallback.
//
// -----------------------------------------------------------------------------
// SHIPPED EMPTY, ON PURPOSE
// -----------------------------------------------------------------------------
//
// #387 is the FOUNDATION: the table, the cipher domain, the store, the
// resolution rule. There is no LLM feature in this repository yet, so there is
// nothing honest to put in this array, and inventing an `llm` entry now would
// mean a registry entry naming a `systemFallback` address that no code writes
// and no administrator can configure — a resolver that always answers `null`
// for a purpose the UI advertises. The worked example below shows exactly what
// the first real entry looks like; uncomment-and-fill is a smaller step than
// deleting a speculative one.
//
// AN ENTRY COSTS ZERO MIGRATIONS. `user_credentials.purpose` is a plain string
// column (see the `UserCredential` block comment in `prisma/schema.prisma`),
// deliberately, so adding a kind of personal credential is this file plus
// whatever feature consumes it — no enum, no schema change, no backfill.
// =============================================================================

/**
 * One kind of personal credential a user may supply, fully described for every
 * surface that stores, renders, or resolves it.
 */
export interface UserCredentialPurposeDef {
  /**
   * The cipher domain component and the second part of the store's address.
   *
   * PERMANENT ONCE ANY ROW EXISTS. This string is folded into the AES sub-key
   * domain `user:<userId>:<purpose>` by `userCredentialPurpose`
   * (common/crypto/secret-cipher.ts), so changing it does not rename anything
   * — it ORPHANS every already-stored ciphertext under the old spelling. The
   * rows stay in the table and become permanently unreadable, exactly as
   * `email/smtp-credential.constants.ts` and
   * `storage/storage-credential.constants.ts` warn about their own purpose
   * constants. Add a new purpose and migrate the rows; never edit one in place.
   *
   * Must satisfy the same grammar the cipher enforces: non-empty, no
   * surrounding whitespace, and NO COLON (the colon is the field delimiter
   * that keeps user domains disjoint from system purposes — see
   * `assertCredentialIdentifier` in credential-internals.ts).
   */
  readonly purpose: string;

  /** Short human label, shown as the heading for this credential's row. */
  readonly label: string;

  /**
   * One sentence, in the user's terms, on what this key is used for and what
   * happens if they do not supply one. This is the only place the answer to
   * "why is this app asking me for an API key?" is written down.
   */
  readonly description: string;

  /**
   * Where the deployment-wide counterpart of this credential lives in the
   * SYSTEM store (`CredentialsService`), or `null` when there is none.
   *
   * THIS IS DATA THE RULE NEEDS, NOT A POLICY KNOB. The resolution rule is
   * fixed and is written down exactly once, in
   * `UserCredentialResolver.resolve`: the user's own key wins, and only if
   * they have none does the system credential apply. This field does not
   * enable, disable, reorder or otherwise modify that rule — it only names the
   * `(purpose, name)` ADDRESS at which the counterpart would be found, because
   * the resolver cannot guess it (a per-user purpose and a system purpose need
   * not share a spelling, and the system side's `name` is its own
   * discriminator).
   *
   * `null` therefore means "this deployment has no shared key for this kind of
   * thing" — a purpose that is bring-your-own-key or nothing. It does NOT mean
   * "fallback disabled", because there is no switch to disable: with no
   * address there is nothing to fall back TO, and `resolve` answers `null`.
   *
   * If a deployment-wide toggle for "may users fall back to our key?" is ever
   * genuinely wanted, it is a system SETTING read by the resolver, not a
   * boolean smuggled in here — a registry entry is a declaration of what
   * exists, and turning it into a place operators tune behaviour is how a
   * registry stops being one list and starts being two.
   */
  readonly systemFallback: {
    readonly purpose: string;
    readonly name: string;
  } | null;
}

/**
 * Every per-user credential purpose this application offers.
 *
 * EMPTY TODAY — see the header for why, and read the worked example below
 * before adding the first entry.
 *
 * An array rather than a map because ORDER is meaningful: whatever page
 * eventually renders a user's keys renders them in this order, and a
 * deterministic order is one fewer thing for that page to decide.
 *
 * ── WHAT THE FIRST REAL ENTRY LOOKS LIKE ─────────────────────────────────
 * Verbatim, minus the comment markers — this is a complete, valid entry, not
 * a sketch:
 *
 *   {
 *     purpose: 'llm',
 *     label: 'AI provider API key',
 *     description:
 *       'Your own Anthropic API key. When set, AI features in this app bill ' +
 *       'your account and use your rate limits instead of the shared key.',
 *     systemFallback: {
 *       purpose: LLM_CREDENTIAL_PURPOSE, // 'llm' — the SYSTEM store's purpose
 *       name: LLM_CREDENTIAL_NAME,       // 'default'
 *     },
 *   },
 *
 * Three things that example is deliberately showing:
 *
 *   1. `systemFallback` references the system store's own address CONSTANTS
 *      (the `email/smtp-credential.constants.ts` pattern — a leaf module
 *      importing nothing), not string literals retyped here. A literal that
 *      differs by a character from the one the system store writes under
 *      produces a fallback that silently never resolves, and nothing fails
 *      loudly enough for anyone to notice.
 *   2. The per-user `purpose` and the system `purpose` happen to be the same
 *      word here, and that is a coincidence of this example rather than a
 *      rule. They are different key spaces — `user:<uuid>:llm` versus bare
 *      `llm` — which is precisely why the address has to be stated rather
 *      than derived.
 *   3. `name` is absent from the per-user side of the entry, because the user
 *      side's `name` is the user's choice (they may hold two keys for one
 *      purpose and label them), not the registry's.
 *
 * For a bring-your-own-key-or-nothing purpose, `systemFallback: null` and the
 * resolver returns `null` when the user has not set one. That is a complete,
 * correct entry too — not a placeholder.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const USER_CREDENTIAL_PURPOSES: readonly UserCredentialPurposeDef[] =
  Object.freeze([] as UserCredentialPurposeDef[]);

/**
 * Purpose -> definition, built once at module load.
 *
 * The list above stays an array because its order is meaningful; this index
 * exists so the resolver's per-call lookup is not a linear scan.
 */
const PURPOSES_BY_KEY: ReadonlyMap<string, UserCredentialPurposeDef> = new Map(
  USER_CREDENTIAL_PURPOSES.map((def) => [def.purpose, def]),
);

/**
 * The definition for `purpose`, or `undefined` when nothing is registered.
 *
 * RETURNS `undefined` RATHER THAN THROWING, for the reason `findEvent` in
 * `notifications/notification-events.ts` gives and which applies here with
 * more force: the caller is frequently holding a string that came from
 * PERSISTED DATA. A `user_credentials` row outlives the registry entry that
 * created it — a purpose retired in code leaves every row written under it
 * sitting in the table, owned by real users. Throwing would turn "list my
 * credentials" into a 500 for exactly the people who have the most stored,
 * and it would do so at the moment someone deletes a line from this file.
 *
 * The caller decides what an unknown purpose means. `UserCredentialsService`
 * treats it as "still a perfectly valid row, show it" — the store addresses
 * rows, it does not police the registry. `UserCredentialResolver` treats it as
 * "no fallback is defined", which is the safe direction: an unregistered
 * purpose must not silently reach for a shared key.
 */
export function findUserCredentialPurpose(
  purpose: string,
): UserCredentialPurposeDef | undefined {
  return PURPOSES_BY_KEY.get(purpose);
}
