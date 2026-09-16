import { BadRequestException } from '@nestjs/common';

import {
  HINT_MASK,
  HINT_MIN_LENGTH_TO_REVEAL,
  HINT_REVEALED_CHARS,
  assertCredentialAddress,
  assertCredentialIdentifier,
  deriveHint,
  isBlankSecret,
} from './credential-internals';

// =============================================================================
// credential-internals — tests (issue #387)
// =============================================================================
//
// These helpers were extracted out of CredentialsService (already covered by
// credentials.service.spec.ts) so both stores present the exact same "what is
// blank" and "what is a hint" contract. This file tests them directly, at the
// unit they now live at, rather than only indirectly through one store.
// =============================================================================

describe('credential-internals', () => {
  // ===========================================================================
  // deriveHint
  // ===========================================================================
  describe('deriveHint', () => {
    it('sanity: the documented threshold and reveal length', () => {
      expect(HINT_MIN_LENGTH_TO_REVEAL).toBe(8);
      expect(HINT_REVEALED_CHARS).toBe(4);
    });

    it('reveals only the mask below the reveal threshold', () => {
      expect(deriveHint('abc')).toBe(HINT_MASK);
      expect(deriveHint('abc123')).toBe(HINT_MASK); // 6 chars
      expect(deriveHint('1234567')).toBe(HINT_MASK); // 7 chars - just below
    });

    it('reveals mask + last 4 characters at/above the reveal threshold', () => {
      expect(deriveHint('12345678')).toBe(`${HINT_MASK}5678`); // exactly 8
      expect(deriveHint('password123')).toBe(`${HINT_MASK}d123`);
    });

    it('boundary: exactly 8 reveals, exactly 7 stays masked', () => {
      expect(deriveHint('1234567')).toBe(HINT_MASK);
      expect(deriveHint('12345678')).toBe(`${HINT_MASK}5678`);
    });

    it('treats the empty string as below threshold', () => {
      expect(deriveHint('')).toBe(HINT_MASK);
    });

    it('counts Unicode code points for the length threshold, not UTF-16 units', () => {
      const fourEmoji = '😀😀😀😀'; // 4 code points, 8 UTF-16 units - the trap
      expect(fourEmoji.length).toBe(8);
      expect(Array.from(fourEmoji).length).toBe(4);

      // A UTF-16-length check would see 8 and reveal; a code-point check sees
      // 4 and masks. Masking is correct.
      expect(deriveHint(fourEmoji)).toBe(HINT_MASK);
    });

    it('reveals whole code points, never splitting a surrogate pair, for a secret ending in an astral emoji', () => {
      // 'abcde' + a surrogate-pair emoji + 'XYZ' is 10 UTF-16 units but 9 code
      // points. A naive `secret.slice(-4)` (UTF-16 units) would take
      // [low-surrogate, X, Y, Z] and produce a lone (invalid) surrogate half -
      // which is exactly the crash-on-the-way-into-Postgres the comment on
      // deriveHint names. The last 4 CODE POINTS are 😀, X, Y, Z.
      const secret = 'abcde😀XYZ';
      expect(secret.length).toBe(10); // UTF-16 units
      expect(Array.from(secret).length).toBe(9); // actual code points

      const hint = deriveHint(secret);
      expect(hint).toBe(`${HINT_MASK}😀XYZ`);

      const LONE_SURROGATE =
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
      expect(hint).not.toMatch(LONE_SURROGATE);
    });

    it('reveals a secret made entirely of astral characters without producing a lone surrogate', () => {
      const secret = '😀😃😄😁😆😅😂🤣'; // 8 code points (at the reveal threshold), 16 UTF-16 units
      expect(Array.from(secret).length).toBe(8);
      const hint = deriveHint(secret);
      // Last 4 code points, in order: 😆 😅 😂 🤣
      expect(hint).toBe(`${HINT_MASK}😆😅😂🤣`);

      const LONE_SURROGATE =
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
      expect(hint).not.toMatch(LONE_SURROGATE);
    });
  });

  // ===========================================================================
  // isBlankSecret
  // ===========================================================================
  describe('isBlankSecret', () => {
    it('treats undefined as blank', () => {
      expect(isBlankSecret(undefined)).toBe(true);
    });

    it('treats null as blank', () => {
      expect(isBlankSecret(null)).toBe(true);
    });

    it('treats the empty string as blank', () => {
      expect(isBlankSecret('')).toBe(true);
    });

    it('does NOT treat a whitespace-only string as blank - the absence of .trim() is deliberate', () => {
      expect(isBlankSecret(' ')).toBe(false);
      expect(isBlankSecret('   ')).toBe(false);
      expect(isBlankSecret('\t')).toBe(false);
      expect(isBlankSecret('\n')).toBe(false);
    });

    it('treats a real value as not blank', () => {
      expect(isBlankSecret('hunter2')).toBe(false);
      expect(isBlankSecret('0')).toBe(false);
    });
  });

  // ===========================================================================
  // assertCredentialIdentifier
  // ===========================================================================
  describe('assertCredentialIdentifier', () => {
    it('rejects an empty string, for either field', () => {
      expect(() => assertCredentialIdentifier('', 'purpose')).toThrow(
        BadRequestException,
      );
      expect(() => assertCredentialIdentifier('', 'name')).toThrow(
        BadRequestException,
      );
    });

    it('rejects leading whitespace', () => {
      expect(() => assertCredentialIdentifier(' smtp', 'purpose')).toThrow(
        BadRequestException,
      );
      expect(() => assertCredentialIdentifier(' default', 'name')).toThrow(
        BadRequestException,
      );
    });

    it('rejects trailing whitespace', () => {
      expect(() => assertCredentialIdentifier('smtp ', 'purpose')).toThrow(
        BadRequestException,
      );
      expect(() => assertCredentialIdentifier('default ', 'name')).toThrow(
        BadRequestException,
      );
    });

    it('rejects leading-and-trailing whitespace', () => {
      expect(() => assertCredentialIdentifier(' smtp ', 'purpose')).toThrow(
        BadRequestException,
      );
    });

    it('rejects a purpose containing ":" (#387 - keeps user/system cipher domains disjoint)', () => {
      expect(() => assertCredentialIdentifier('foo:bar', 'purpose')).toThrow(
        BadRequestException,
      );
      expect(() => assertCredentialIdentifier('foo:bar', 'purpose')).toThrow(
        /":"/,
      );
      expect(() => assertCredentialIdentifier(':', 'purpose')).toThrow(
        BadRequestException,
      );
    });

    it('does NOT reject a name containing ":" - the colon rule is purpose-only', () => {
      expect(() =>
        assertCredentialIdentifier('foo:bar', 'name'),
      ).not.toThrow();
    });

    it('accepts each of the three real system purposes', () => {
      for (const purpose of ['smtp', 'storage', 'push_vapid']) {
        expect(() =>
          assertCredentialIdentifier(purpose, 'purpose'),
        ).not.toThrow();
      }
    });

    it('accepts an ordinary name', () => {
      expect(() =>
        assertCredentialIdentifier('default', 'name'),
      ).not.toThrow();
    });

    it('rejects a non-string value despite the string type', () => {
      expect(() =>
        assertCredentialIdentifier(42 as unknown as string, 'purpose'),
      ).toThrow(BadRequestException);
      expect(() =>
        assertCredentialIdentifier(undefined as unknown as string, 'purpose'),
      ).toThrow(BadRequestException);
      expect(() =>
        assertCredentialIdentifier(null as unknown as string, 'name'),
      ).toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // assertCredentialAddress
  // ===========================================================================
  describe('assertCredentialAddress', () => {
    it('accepts a valid (purpose, name) pair', () => {
      expect(() => assertCredentialAddress('smtp', 'default')).not.toThrow();
    });

    it('rejects when purpose is invalid', () => {
      expect(() => assertCredentialAddress('bad:purpose', 'default')).toThrow(
        BadRequestException,
      );
    });

    it('rejects when name is invalid', () => {
      expect(() => assertCredentialAddress('smtp', ' bad-name ')).toThrow(
        BadRequestException,
      );
    });

    it('validates purpose first when both halves are invalid', () => {
      // Purpose's own error text (the colon-delimiter explanation) should be
      // the one surfaced, since assertCredentialAddress checks purpose first.
      expect(() =>
        assertCredentialAddress('bad:purpose', ' bad-name '),
      ).toThrow(/":"/);
    });
  });
});
