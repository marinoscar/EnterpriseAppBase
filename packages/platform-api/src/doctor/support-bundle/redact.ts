// =============================================================================
// Support-bundle redaction, rules v1 (issue #772, PP-13.1)
// =============================================================================
//
// THE SECOND LINE OF DEFENCE. Every section already allowlists its fields
// through a strict schema; this pass runs over the whole assembled bundle
// afterwards and replaces anything that still looks like secret material or
// personal data. It is pure (no I/O, no clock), deterministic and counted:
// every replacement increments `redaction.replacements` in the bundle.
//
// Two kinds of rule:
//
//   KEY-BASED. A property whose NAME matches `SENSITIVE_KEY_PATTERN` has its
//   (non-null) value replaced by "[redacted]", whatever its type.
//
//   VALUE-BASED. Every string, and every property name, is rewritten by
//   `VALUE_RULES`, in order (the order matters: a bearer token is replaced as
//   a whole before the JWT rule could see half of it, URL userinfo before the
//   email rule could mistake `user:pass@host.tld` for an address).
//
// ONE PATH ALLOWLIST. A 40-hex-digit commit SHA is needed to diagnose a
// deployment and is not a secret, but the long-hex rule cannot tell it from a
// key. It survives ONLY at the paths in `COMMIT_SHA_ALLOWED_PATHS`, and only
// when the whole value is exactly 40 hex digits; anything else at those paths
// is redacted as usual. An explicit path list, not a relaxed pattern.
//
// Over-redaction is the accepted failure mode: a support engineer can ask for
// a value; a leaked key cannot be un-leaked.
// =============================================================================

import { isIP } from 'node:net';

/**
 * The rule set this file implements, as recorded in the bundle (`redaction.rules`).
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_REDACTION_VERSION = 'v1' as const;

/**
 * What a redacted value or token becomes.
 *
 * @stability experimental
 */
export const REDACTED = '[redacted]';

/**
 * A property whose name matches has its value replaced by {@link REDACTED}.
 *
 * @stability experimental
 */
export const SENSITIVE_KEY_PATTERN =
  /pass(word)?|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|credential|fingerprint|hint|dsn|connection[_-]?string/i;

/**
 * Where (dotted paths from the bundle root, `*` for an array index) a value
 * that is exactly a 40-hex-digit commit SHA is kept.
 *
 * @stability experimental
 */
export const COMMIT_SHA_ALLOWED_PATHS: readonly string[] = Object.freeze([
  'sections.versions.data.app.commitSha',
  'sections.versions.data.history.last.commitSha',
]);

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/** One value-based rule: a global pattern and what each match becomes. */
interface ValueRule {
  readonly name: string;
  readonly pattern: RegExp;
  /** Returns the replacement, or `null` to keep the match (not counted). */
  readonly replace: (match: string, ...groups: string[]) => string | null;
}

/** A piece of a long run that reads as a word, a number or an identifier part. */
const WORDY_PIECE = [/^[a-z]+[0-9]*$/, /^[A-Z]?[a-z]+(?:[A-Z][a-z]+)*[0-9]*$/, /^[A-Z]+[0-9]*$/, /^[0-9]+$/];

/**
 * Whether a run of 32 or more base64/hex characters is secret-like: hex (dashes
 * allowed between groups, so a UUID counts), or anything that is not a path or
 * identifier made of words (`/api/admin/telemetry/stack`, `snake_case_names`,
 * `camelCaseNames`).
 */
function isSecretLikeRun(run: string): boolean {
  const core = run.replace(/=+$/, '');
  if (core.length < 32) return false;
  if (/^[0-9a-fA-F-]+$/.test(core) && core.replace(/-/g, '').length >= 32) return true;
  const pieces = core.split(/[/_.+-]+/).filter((piece) => piece !== '');
  return !pieces.every((piece) => WORDY_PIECE.some((pattern) => pattern.test(piece)));
}

/** IPv6 candidates are validated by `node:net`, so times (`12:34:56`) and `std::string` survive. */
function redactIpv6(match: string): string | null {
  let candidate = match;
  let trailing = '';
  while (candidate.endsWith('.')) {
    candidate = candidate.slice(0, -1);
    trailing += '.';
  }
  return isIP(candidate) === 6 ? `[ip]${trailing}` : null;
}

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';

/**
 * The value-based rules of v1, in the order they run.
 */
const VALUE_RULES: readonly ValueRule[] = [
  {
    name: 'pem',
    pattern: /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g,
    replace: () => '[pem]',
  },
  {
    // A token after `Bearer` holds at least one non-letter, so prose
    // ("Bearer requests") survives.
    name: 'bearer',
    pattern: /\b(Bearer)\s+(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]{6,}/gi,
    replace: (_match, word) => `${word} ${REDACTED}`,
  },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
    replace: () => '[jwt]',
  },
  {
    name: 'url-userinfo',
    pattern: /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/?#@]+@/g,
    replace: (_match, scheme) => `${scheme}${REDACTED}@`,
  },
  {
    name: 'url-query',
    pattern: /(\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s?#"'<>]*)\?[^\s#"'<>]+/g,
    replace: (_match, url) => `${url}?${REDACTED}`,
  },
  {
    // A path with a query string, without a scheme (`GET /api/x?token=...`).
    name: 'path-query',
    pattern: /((?:^|[\s"'(=])\/[^\s?#"'<>]*)\?[^\s#"'<>)]+/g,
    replace: (_match, path) => `${path}?${REDACTED}`,
  },
  {
    // Personal access tokens and node tokens (`pat_`, `nod_`).
    name: 'opaque-token',
    pattern: /\b(?:pat|nod)_[A-Za-z0-9_-]{8,}/g,
    replace: () => '[token]',
  },
  {
    name: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replace: () => '[aws-key]',
  },
  {
    name: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    replace: () => '[email]',
  },
  {
    name: 'ipv6',
    pattern: /(?<![0-9A-Za-z:.])(?=[0-9A-Fa-f:.]*:[0-9A-Fa-f.]*:)[0-9A-Fa-f:.]{2,45}(?![0-9A-Za-z:])/g,
    replace: redactIpv6,
  },
  {
    name: 'ipv4',
    pattern: new RegExp(`(?<![0-9.])(?:${OCTET}\\.){3}${OCTET}(?![0-9]|\\.\\d)`, 'g'),
    replace: () => '[ip]',
  },
  {
    name: 'long-run',
    pattern: /[A-Za-z0-9+/=_-]{32,}/g,
    replace: (match) => (isSecretLikeRun(match) ? REDACTED : null),
  },
];

/**
 * A redacted value and how many replacements it took.
 *
 * @typeParam T - the value's type.
 *
 * @stability experimental
 */
export interface RedactionResult<T> {
  /** The redacted copy (the input is never mutated). */
  value: T;
  /** How many keys, tokens or patterns were replaced. */
  replacements: number;
}

/**
 * Applies the value-based rules to one string.
 *
 * @param input - any string.
 * @returns the rewritten string and the number of replacements.
 *
 * @example
 * ```ts
 * redactString('mail ops@example.com from 10.0.0.1'); // { value: 'mail [email] from [ip]', replacements: 2 }
 * ```
 *
 * @stability experimental
 */
export function redactString(input: string): RedactionResult<string> {
  let value = input;
  let replacements = 0;
  for (const rule of VALUE_RULES) {
    value = value.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.filter((part): part is string => typeof part === 'string');
      const replaced = rule.replace(match, ...groups);
      if (replaced === null) return match;
      replacements += 1;
      return replaced;
    });
  }
  return { value, replacements };
}

/** Options of {@link redactValue}. */
interface RedactValueOptions {
  /** The path of `value` from the bundle root (for the commit-SHA allowlist). Default `[]`. */
  path?: readonly string[];
  /** Dotted paths where an exact 40-hex commit SHA is kept. Default {@link COMMIT_SHA_ALLOWED_PATHS}. */
  commitShaPaths?: readonly string[];
}

/**
 * Redacts a JSON-like value: every string and property name by the value
 * rules, every property whose name matches {@link SENSITIVE_KEY_PATTERN} by
 * key. Returns a new value; the input is never mutated.
 *
 * @param value - a JSON-like value (objects, arrays, strings, numbers, booleans, null).
 * @param options - the value's `path` from the bundle root, and the commit-SHA allowlist.
 * @returns the redacted copy and the number of replacements.
 *
 * @stability experimental
 */
export function redactValue<T>(value: T, options: RedactValueOptions = {}): RedactionResult<T> {
  const allowed = new Set(options.commitShaPaths ?? COMMIT_SHA_ALLOWED_PATHS);
  let replacements = 0;

  const walk = (node: unknown, path: string[]): unknown => {
    if (typeof node === 'string') {
      if (COMMIT_SHA.test(node) && allowed.has(path.join('.'))) return node;
      const result = redactString(node);
      replacements += result.replacements;
      return result.value;
    }
    if (Array.isArray(node)) return node.map((item) => walk(item, [...path, '*']));
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const renamed = redactString(key);
        replacements += renamed.replacements;
        let outKey = renamed.value;
        for (let n = 2; Object.prototype.hasOwnProperty.call(out, outKey); n += 1) outKey = `${renamed.value}#${n}`;
        if (SENSITIVE_KEY_PATTERN.test(key) && child !== null && child !== undefined) {
          replacements += 1;
          out[outKey] = REDACTED;
        } else {
          out[outKey] = walk(child, [...path, key]);
        }
      }
      return out;
    }
    return node;
  };

  return { value: walk(value, [...(options.path ?? [])]) as T, replacements };
}
