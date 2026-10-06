import { csvField, csvRecord, FORMULA_TRIGGER, neutralizeFormula, UTF8_BOM } from './csv';

describe('csv helpers', () => {
  describe('UTF8_BOM', () => {
    it('is the single U+FEFF character, three bytes in UTF-8', () => {
      expect(UTF8_BOM).toBe('﻿');
      expect(UTF8_BOM).toHaveLength(1);
      expect(Buffer.from(UTF8_BOM, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    });
  });

  describe('csvField', () => {
    it('leaves plain text unquoted', () => {
      expect(csvField('hello world')).toBe('hello world');
      expect(csvField('')).toBe('');
    });

    it.each([
      ['a comma', 'a,b', '"a,b"'],
      ['a double quote', 'say "hi"', '"say ""hi"""'],
      ['a carriage return', 'line1\rline2', '"line1\rline2"'],
      ['a line feed', 'line1\nline2', '"line1\nline2"'],
      ['a CRLF', 'line1\r\nline2', '"line1\r\nline2"'],
    ])('quotes a field holding %s (RFC 4180)', (_label, input, expected) => {
      expect(csvField(input)).toBe(expected);
    });

    it('doubles every quote, not only the first', () => {
      expect(csvField('""')).toBe('""""""');
    });
  });

  describe('neutralizeFormula', () => {
    it.each([
      ['=', '=SUM(A1:A2)'],
      ['+', '+1'],
      ['-', '-cmd'],
      ['@', '@SUM(A1)'],
      ['tab', '\tvalue'],
      ['carriage return', '\rvalue'],
    ])('prefixes a value starting with %s with a single quote', (_label, input) => {
      expect(FORMULA_TRIGGER.test(input)).toBe(true);
      expect(neutralizeFormula(input)).toBe(`'${input}`);
    });

    it('leaves values that do not start with a trigger alone', () => {
      expect(neutralizeFormula('plain')).toBe('plain');
      expect(neutralizeFormula('a=b')).toBe('a=b');
      expect(neutralizeFormula('')).toBe('');
    });

    it('would neutralize a negative number, which is why callers skip numeric columns', () => {
      // Callers apply neutralizeFormula to text only; a numeric column passes
      // through csvField untouched so `-5` stays `-5`.
      expect(neutralizeFormula('-5')).toBe("'-5");
      expect(csvField('-5')).toBe('-5');
    });

    it('composes with csvField: neutralize first, then quote', () => {
      expect(csvField(neutralizeFormula('=HYPERLINK("x","y")'))).toBe('"\'=HYPERLINK(""x"",""y"")"');
    });
  });

  describe('csvRecord', () => {
    it('joins fields with a comma and adds no line ending', () => {
      expect(csvRecord(['a', 'b', 'c'])).toBe('a,b,c');
      expect(csvRecord([])).toBe('');
    });

    it('does not quote on its own: fields are passed through csvField first', () => {
      expect(csvRecord([csvField('a,b'), csvField('c')])).toBe('"a,b",c');
    });
  });
});
