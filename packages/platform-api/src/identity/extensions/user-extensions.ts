// =============================================================================
// User extensions: what an app adds to `GET /api/auth/me` and to each row of
// `GET /api/users` (PP-14.25)
// =============================================================================
//
// Rung 2 of the extension contract. An app attaches its own facts about a user
// (a plan, a team, an unread count) to the two payloads the web app already
// reads, with no new route and no edit under `packages/`:
//
//   registerCurrentUserExtension({ id: 'billing', resolve: async (userId, ctx) => ({ plan: 'pro' }) });
//   registerUserListExtension({ id: 'billing', resolve: async (userIds, ctx) => new Map([...]) });
//
// The contributions appear as `extensions: { billing: { plan: 'pro' } }`, keyed
// by the extension id. Nothing registered, no `extensions` key: the payloads are
// exactly what they were.
//
// IDENTITY DATA IS SENSITIVE, so the contract is strict, and every rule is
// enforced here, not left to the extension's good manners:
//
//   - JSON only: plain objects, arrays, strings, finite numbers, booleans and
//     null, at most `USER_EXTENSION_LIMITS.maxDepth` levels deep. A class
//     instance, a function, a `bigint`, a `Date` or a cycle is refused.
//   - Bounded: one extension's JSON is at most `currentUserBytes` (4 KiB) in
//     `/auth/me` and `userListBytes` (1 KiB) per row of the list, and all
//     extensions together at most `currentUserTotalBytes` / `userListTotalBytes`.
//     Over a bound the extension's contribution is DROPPED, never truncated.
//   - Never secrets: a key that names a secret (`password`, `token`, `apiKey`,
//     `clientSecret`, ... at any depth, any case; a `hasToken` presence flag is
//     fine) and a string value that is plainly a credential (a JWT, a PEM
//     private key, a platform `pat_` / `nod_` / `lnk_` token) are refused. The
//     same idea as the credential store: a secret belongs in
//     `CredentialsService`, never in a payload a browser reads.
//   - Isolated: each extension runs under its own timeout and its failure
//     (a throw, a rejection, a timeout, a refused contribution) skips THAT
//     extension and is logged at `warn` with its id and the reason, never its
//     data. A throwing extension never fails `/auth/me` or the list.
//   - Resolved per request, never cached by the slice.
//   - No N+1: a list extension is called ONCE per request with the ids of the
//     page (at most one page of users) and answers a `Map` keyed by user id. It
//     cannot answer for a user that is not on the page: such entries are
//     ignored, so an extension cannot use the list to leak about other users.
//
// The registries freeze when the application has bootstrapped
// (`RegistryFreezeService`); register at import time, from
// `apps/api/src/app-registrations/identity.ts`.
// =============================================================================

import { USER_EXTENSION_ID_PATTERN, USER_EXTENSION_LIMITS } from '@marinoscar/platform-contract/identity';
import { Logger } from '@nestjs/common';

import { defineRegistry, type Registry } from '../../core/index';

/**
 * The JSON object an extension contributes. Typed as `object` so an interface or a
 * class-free record both fit; the runtime check ({@link checkUserExtensionContribution})
 * is what holds it to plain JSON.
 */
type Contribution = object;

/**
 * The default timeout of a current-user extension, in milliseconds. It runs on every `/auth/me`.
 *
 * @stability experimental
 */
export const DEFAULT_CURRENT_USER_EXTENSION_TIMEOUT_MS = 1500;
/**
 * The default timeout of a user-list extension, in milliseconds.
 *
 * @stability experimental
 */
export const DEFAULT_USER_LIST_EXTENSION_TIMEOUT_MS = 3000;
/**
 * The longest timeout an extension may ask for, in milliseconds.
 *
 * @stability experimental
 */
export const MAX_USER_EXTENSION_TIMEOUT_MS = 10_000;

/**
 * What a current-user extension is told about the request.
 *
 * @stability experimental
 */
export interface CurrentUserExtensionContext {
  /** The organization the session acts in (`null` when it acts in none). */
  readonly orgId: string | null;
  /** Aborted when the extension's timeout elapses; pass it to the I/O the extension starts. */
  readonly signal: AbortSignal;
}

/**
 * What a user-list extension is told about the request.
 *
 * @stability experimental
 */
export interface UserListExtensionContext {
  /** The administrator who asked for the list, when known. */
  readonly viewerId: string | null;
  /** The organization the session acts in (`null` when it acts in none). */
  readonly orgId: string | null;
  /** Aborted when the extension's timeout elapses; pass it to the I/O the extension starts. */
  readonly signal: AbortSignal;
}

/**
 * One extension of `GET /api/auth/me`.
 *
 * @example
 * ```ts
 * registerCurrentUserExtension({
 *   id: 'billing',
 *   resolve: async (userId) => ({ plan: await plans.planOf(userId) }),
 * });
 * ```
 *
 * @stability experimental
 */
export interface CurrentUserExtension {
  /** Lower-case id (`USER_EXTENSION_ID_PATTERN`); the key of the contribution under `extensions`. */
  id: string;
  /**
   * The contribution for the signed-in user: a small JSON object, or
   * `null` / `undefined` for none. Throwing skips this extension and is logged.
   *
   * @param userId - the signed-in user's id.
   * @param ctx - the request context.
   */
  resolve(userId: string, ctx: CurrentUserExtensionContext): Promise<Contribution | null | undefined> | Contribution | null | undefined;
  /**
   * How long `resolve` may take before the extension is skipped.
   *
   * @defaultValue {@link DEFAULT_CURRENT_USER_EXTENSION_TIMEOUT_MS}
   */
  timeoutMs?: number;
}

/**
 * One extension of each row of `GET /api/users`.
 *
 * @example
 * ```ts
 * registerUserListExtension({
 *   id: 'billing',
 *   // ONE query for the whole page, never one per row.
 *   resolve: async (userIds) => new Map((await plans.forUsers(userIds)).map((p) => [p.userId, { plan: p.name }])),
 * });
 * ```
 *
 * @stability experimental
 */
export interface UserListExtension {
  /** Lower-case id (`USER_EXTENSION_ID_PATTERN`); the key of the contribution under each row's `extensions`. */
  id: string;
  /**
   * The contributions for the users of the page, as a `Map` from user id to a
   * small JSON object. Called ONCE per request with every id of the page. A user
   * missing from the map gets no contribution; an id that is not in `userIds` is
   * ignored. Throwing skips this extension and is logged.
   *
   * @param userIds - the ids of the users on this page.
   * @param ctx - the request context.
   */
  resolve(
    userIds: readonly string[],
    ctx: UserListExtensionContext,
  ): Promise<ReadonlyMap<string, Contribution | null | undefined>> | ReadonlyMap<string, Contribution | null | undefined>;
  /**
   * How long `resolve` may take before the extension is skipped.
   *
   * @defaultValue {@link DEFAULT_USER_LIST_EXTENSION_TIMEOUT_MS}
   */
  timeoutMs?: number;
}

function validateExtension(kind: string, extension: { resolve?: unknown; timeoutMs?: unknown }): void {
  if (typeof extension.resolve !== 'function') {
    throw new Error(`${kind} must declare a resolve function`);
  }
  const timeout = extension.timeoutMs;
  if (timeout !== undefined && !(typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 && timeout <= MAX_USER_EXTENSION_TIMEOUT_MS)) {
    throw new Error(`${kind} timeoutMs must be a number between 1 and ${MAX_USER_EXTENSION_TIMEOUT_MS}`);
  }
}

/**
 * The registered extensions of `GET /api/auth/me`, in registration order.
 *
 * @stability experimental
 */
export const currentUserExtensionRegistry: Registry<CurrentUserExtension> = defineRegistry<CurrentUserExtension>({
  name: 'identity-current-user-extensions',
  idOf: (extension) => extension.id,
  idPattern: USER_EXTENSION_ID_PATTERN,
  validate: (extension) => validateExtension('a current-user extension', extension),
});

/**
 * The registered extensions of the rows of `GET /api/users`, in registration order.
 *
 * @stability experimental
 */
export const userListExtensionRegistry: Registry<UserListExtension> = defineRegistry<UserListExtension>({
  name: 'identity-user-list-extensions',
  idOf: (extension) => extension.id,
  idPattern: USER_EXTENSION_ID_PATTERN,
  validate: (extension) => validateExtension('a user-list extension', extension),
});

/**
 * Add a field group to `GET /api/auth/me`, under `extensions.<id>`.
 *
 * Call it once, at import time (before the application bootstraps), from
 * `apps/api/src/app-registrations/identity.ts`. The slice resolves it on every
 * request, bounds and checks what it returns (JSON only, no secrets, see the
 * file header) and skips it, with a logged warning, when it throws or times out.
 *
 * @param extension - the id and the resolver.
 * @throws RegistryError when the id is malformed or taken, the resolver is missing or the timeout is out of range, or the registry is frozen.
 *
 * @example
 * ```ts
 * registerCurrentUserExtension({ id: 'billing', resolve: async (userId) => ({ plan: 'pro' }) });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerCurrentUserExtension(extension: CurrentUserExtension): void {
  currentUserExtensionRegistry.register(extension);
}

/**
 * Add a field group to each row of `GET /api/users`, under `extensions.<id>`.
 *
 * The resolver is BATCHED: it receives every id of the page at once and answers
 * a `Map`, so a list of 100 users costs the extension one query, not 100. The
 * same bounds and checks as {@link registerCurrentUserExtension} apply per row.
 *
 * @param extension - the id and the batch resolver.
 * @throws RegistryError when the id is malformed or taken, the resolver is missing or the timeout is out of range, or the registry is frozen.
 *
 * @example
 * ```ts
 * registerUserListExtension({
 *   id: 'billing',
 *   resolve: async (ids) => new Map((await plans.forUsers(ids)).map((p) => [p.userId, { plan: p.name }])),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerUserListExtension(extension: UserListExtension): void {
  userListExtensionRegistry.register(extension);
}

// -----------------------------------------------------------------------------
// The contribution check
// -----------------------------------------------------------------------------

/** Key names (compared lower-case, letters and digits only) that name a secret, at any depth. */
const SECRET_KEY_SUFFIXES: readonly string[] = [
  'secret',
  'password',
  'passwd',
  'passphrase',
  'token',
  'apikey',
  'privatekey',
  'signingkey',
  'accesskey',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'bearer',
  'otp',
];

/** Keys that would reach `Object.prototype` through a naive merge. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** String values that are plainly a credential. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*$/, // a JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // a PEM private key
  /^Bearer\s+\S{8,}/i,
  /^(?:pat|nod|lnk)_[A-Za-z0-9_-]{16,}$/, // this platform's own token prefixes
];

/** Whether a key names a secret. A `hasToken` presence flag is not a secret. */
function isSecretKey(key: string): boolean {
  if (/^has[A-Z_-]/.test(key)) return false;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_KEY_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(suffix));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

type Cleaned = { ok: true; value: unknown } | { ok: false; reason: string };

/** What one check may spend: no JSON value is smaller than a byte, so a payload over `maxBytes` values is over the byte bound already. */
interface CheckBudget {
  /** Values still allowed. */
  nodes: number;
  /** The byte bound of the whole contribution. */
  maxBytes: number;
}

function clean(value: unknown, depth: number, path: string, budget: CheckBudget): Cleaned {
  budget.nodes -= 1;
  if (budget.nodes < 0) return { ok: false, reason: `${path} is part of a contribution with more values than the ${budget.maxBytes} byte bound can hold` };
  if (value === null || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'string') {
    // UTF-8 is at least one byte per UTF-16 unit: refuse before scanning a huge string.
    if (value.length > budget.maxBytes) return { ok: false, reason: `${path} is a string over the ${budget.maxBytes} byte bound` };
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      return { ok: false, reason: `${path} holds what looks like a credential` };
    }
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: `${path} is not a finite number` };
  }
  if (depth > USER_EXTENSION_LIMITS.maxDepth) {
    return { ok: false, reason: `${path} is nested deeper than ${USER_EXTENSION_LIMITS.maxDepth} levels` };
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = clean(value[index], depth + 1, `${path}[${index}]`, budget);
      if (!item.ok) return item;
      items.push(item.value);
    }
    return { ok: true, value: items };
  }
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) return { ok: false, reason: `${path} has the key "${key}"` };
      if (isSecretKey(key)) return { ok: false, reason: `${path}.${key} is named like a secret` };
      const raw = value[key];
      if (raw === undefined) continue; // JSON drops it
      const item = clean(raw, depth + 1, `${path}.${key}`, budget);
      if (!item.ok) return item;
      copy[key] = item.value;
    }
    return { ok: true, value: copy };
  }
  return { ok: false, reason: `${path} is not JSON (${typeof value})` };
}

/**
 * A contribution that passed {@link checkUserExtensionContribution}.
 *
 * @stability experimental
 */
export interface UserExtensionAccepted {
  /** The check passed. */
  ok: true;
  /** A clean deep copy of the contribution, safe to merge into a payload. */
  value: Record<string, unknown>;
  /** Its size as JSON, in UTF-8 bytes. */
  bytes: number;
}

/**
 * A contribution that {@link checkUserExtensionContribution} refused.
 *
 * @stability experimental
 */
export interface UserExtensionRefused {
  /** The check failed. */
  ok: false;
  /** Why, naming the offending path but never its value. */
  reason: string;
}

/**
 * The outcome of {@link checkUserExtensionContribution}.
 *
 * @stability experimental
 */
export type UserExtensionCheck = UserExtensionAccepted | UserExtensionRefused;

/**
 * Check one extension's contribution against the contract (JSON only, bounded,
 * no secret) and return a clean deep copy of it. Exported for the conformance
 * test and for an app that wants to check its own resolver; the slice calls it
 * on every contribution.
 *
 * @param value - what the extension returned.
 * @param maxBytes - the byte bound of the JSON (`USER_EXTENSION_LIMITS`).
 * @returns the clean copy and its size, or why it was refused.
 *
 * @stability experimental
 */
export function checkUserExtensionContribution(value: unknown, maxBytes: number): UserExtensionCheck {
  if (!isPlainObject(value)) return { ok: false, reason: 'the contribution is not a JSON object' };
  const cleaned = clean(value, 1, 'the contribution', { nodes: maxBytes, maxBytes });
  if (!cleaned.ok) return cleaned;
  const bytes = Buffer.byteLength(JSON.stringify(cleaned.value), 'utf8');
  if (bytes > maxBytes) return { ok: false, reason: `the contribution is ${bytes} bytes, over the ${maxBytes} byte bound` };
  return { ok: true, value: cleaned.value as Record<string, unknown>, bytes };
}

// -----------------------------------------------------------------------------
// Resolution
// -----------------------------------------------------------------------------

/**
 * Where a refusal or a failure is reported. `Logger` of `@nestjs/common` satisfies it.
 *
 * @stability experimental
 */
export interface UserExtensionLog {
  /** Report a skipped extension. */
  warn(message: string): void;
}

/**
 * How often the slice's own logger repeats the same warning (an extension that
 * fails on every `/auth/me` would otherwise write one line per request).
 */
const LOG_REPEAT_INTERVAL_MS = 60_000;

/** A logger that writes a given message at most once a minute and counts the repeats it swallowed. */
function throttledLog(inner: UserExtensionLog): UserExtensionLog {
  const lastWritten = new Map<string, { at: number; suppressed: number }>();
  return {
    warn(message: string): void {
      const now = Date.now();
      const seen = lastWritten.get(message);
      if (seen && now - seen.at < LOG_REPEAT_INTERVAL_MS) {
        seen.suppressed += 1;
        return;
      }
      lastWritten.set(message, { at: now, suppressed: 0 });
      if (lastWritten.size > 200) lastWritten.delete(lastWritten.keys().next().value as string);
      inner.warn(seen && seen.suppressed > 0 ? `${message} (${seen.suppressed} similar warnings in the last minute were not repeated)` : message);
    },
  };
}

const defaultLog: UserExtensionLog = throttledLog(new Logger('IdentityUserExtensions'));

/**
 * The most calls of one extension that may be running at once. A call that
 * timed out is abandoned, not killed (JavaScript cannot), so an extension that
 * hangs on every request would otherwise pile up work without bound; past this
 * many unfinished calls it is skipped until some finish.
 *
 * @stability experimental
 */
export const MAX_IN_FLIGHT_PER_USER_EXTENSION = 16;

const inFlight = new Map<string, number>();

/** Runs `run` under a timeout; the signal aborts when it elapses. `key` counts the unfinished calls of one extension. */
async function withTimeout<T>(key: string, timeoutMs: number, run: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
  const running = inFlight.get(key) ?? 0;
  if (running >= MAX_IN_FLIGHT_PER_USER_EXTENSION) {
    throw new Error(`${running} earlier calls are still running; skipped until some finish`);
  }
  inFlight.set(key, running + 1);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();
  });
  const work = Promise.resolve().then(() => run(controller.signal));
  // Counted until the work ITSELF settles, even after the timeout gave up on it.
  const done = () => {
    const left = (inFlight.get(key) ?? 1) - 1;
    if (left <= 0) inFlight.delete(key);
    else inFlight.set(key, left);
  };
  work.then(done, done);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The longest error message that reaches the log. */
const MAX_LOGGED_MESSAGE_LENGTH = 300;

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_LOGGED_MESSAGE_LENGTH ? `${message.slice(0, MAX_LOGGED_MESSAGE_LENGTH)}...` : message;
}

/**
 * Resolve every current-user extension for one user. Never throws: an extension
 * that fails, times out or returns something the contract refuses is skipped and
 * logged. Extensions run concurrently; the result keeps registration order.
 *
 * @param userId - the signed-in user.
 * @param context - the organization the session acts in.
 * @param log - where skipped extensions are reported. Default the slice's logger.
 * @returns the `extensions` object, or `undefined` when no extension contributed.
 *
 * @stability experimental
 */
export async function resolveCurrentUserExtensions(
  userId: string,
  context: { orgId: string | null },
  log: UserExtensionLog = defaultLog,
): Promise<Record<string, Record<string, unknown>> | undefined> {
  const extensions = currentUserExtensionRegistry.list();
  if (extensions.length === 0) return undefined;

  const settled = await Promise.all(
    extensions.map(async (extension) => {
      try {
        const raw = await withTimeout(`me:${extension.id}`, extension.timeoutMs ?? DEFAULT_CURRENT_USER_EXTENSION_TIMEOUT_MS, (signal) =>
          extension.resolve(userId, { orgId: context.orgId, signal }),
        );
        if (raw === null || raw === undefined) return null;
        const checked = checkUserExtensionContribution(raw, USER_EXTENSION_LIMITS.currentUserBytes);
        if (!checked.ok) {
          log.warn(`Current-user extension "${extension.id}" skipped: ${checked.reason}`);
          return null;
        }
        return { id: extension.id, value: checked.value, bytes: checked.bytes };
      } catch (error) {
        log.warn(`Current-user extension "${extension.id}" failed and was skipped: ${messageOf(error)}`);
        return null;
      }
    }),
  );

  const result: Record<string, Record<string, unknown>> = {};
  let total = 0;
  for (const entry of settled) {
    if (!entry) continue;
    if (total + entry.bytes > USER_EXTENSION_LIMITS.currentUserTotalBytes) {
      log.warn(`Current-user extension "${entry.id}" skipped: the extensions together would exceed ${USER_EXTENSION_LIMITS.currentUserTotalBytes} bytes`);
      continue;
    }
    total += entry.bytes;
    result[entry.id] = entry.value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Resolve every user-list extension for one page of users, each extension called
 * ONCE with the page's ids. Never throws: a failing, slow or refused extension is
 * skipped (for the whole page, or for the one row whose contribution was refused)
 * and logged.
 *
 * @param userIds - the ids of the users on the page.
 * @param context - the requesting administrator and the organization.
 * @param log - where skipped extensions are reported. Default the slice's logger.
 * @returns a map from user id to that user's `extensions`; users with none are absent.
 *
 * @stability experimental
 */
export async function resolveUserListExtensions(
  userIds: readonly string[],
  context: { viewerId: string | null; orgId: string | null },
  log: UserExtensionLog = defaultLog,
): Promise<Map<string, Record<string, Record<string, unknown>>>> {
  const out = new Map<string, Record<string, Record<string, unknown>>>();
  const extensions = userListExtensionRegistry.list();
  if (extensions.length === 0 || userIds.length === 0) return out;

  const onPage = new Set(userIds);
  const bytesByUser = new Map<string, number>();

  const answers = await Promise.all(
    extensions.map(async (extension) => {
      try {
        const answer = await withTimeout(`list:${extension.id}`, extension.timeoutMs ?? DEFAULT_USER_LIST_EXTENSION_TIMEOUT_MS, (signal) =>
          extension.resolve(userIds, { viewerId: context.viewerId, orgId: context.orgId, signal }),
        );
        if (!(answer instanceof Map)) {
          log.warn(`User-list extension "${extension.id}" skipped: it must answer a Map from user id to contribution`);
          return null;
        }
        return { extension, answer };
      } catch (error) {
        log.warn(`User-list extension "${extension.id}" failed and was skipped: ${messageOf(error)}`);
        return null;
      }
    }),
  );

  for (const entry of answers) {
    if (!entry) continue;
    const { extension, answer } = entry;
    try {
      for (const [userId, raw] of answer) {
        if (!onPage.has(userId) || raw === null || raw === undefined) continue;
        const checked = checkUserExtensionContribution(raw, USER_EXTENSION_LIMITS.userListBytes);
        if (!checked.ok) {
          log.warn(`User-list extension "${extension.id}" skipped for one row: ${checked.reason}`);
          continue;
        }
        const used = bytesByUser.get(userId) ?? 0;
        if (used + checked.bytes > USER_EXTENSION_LIMITS.userListTotalBytes) {
          log.warn(`User-list extension "${extension.id}" skipped for one row: the extensions together would exceed ${USER_EXTENSION_LIMITS.userListTotalBytes} bytes`);
          continue;
        }
        bytesByUser.set(userId, used + checked.bytes);
        const row = out.get(userId) ?? {};
        row[extension.id] = checked.value;
        out.set(userId, row);
      }
    } catch (error) {
      // A throwing getter, a hostile iterator: this extension's remaining rows are skipped, the request is not.
      log.warn(`User-list extension "${extension.id}" failed while its answer was read and was skipped: ${messageOf(error)}`);
    }
  }
  return out;
}
