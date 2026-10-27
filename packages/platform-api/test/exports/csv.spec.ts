import { CSV_LINE_END, FORMULA_TRIGGER, UTF8_BOM, csvCell, csvField, csvRecord, neutralizeFormula } from '../../src/exports';

// The CSV helpers (EvoPath `common/export/csv.ts`, packaged by #744).
describe('CSV helpers', () => {
  it('is the UTF-8 BOM and CRLF', () => {
    expect(UTF8_BOM).toBe('﻿');
    expect(Buffer.from(UTF8_BOM, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(CSV_LINE_END).toBe('\r\n');
  });

  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['carriage\rreturn', '"carriage\rreturn"'],
    ['', ''],
  ])('quotes %j as RFC 4180 requires', (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('neutralises the formula trigger in %j', (input) => {
    expect(FORMULA_TRIGGER.test(input)).toBe(true);
    expect(neutralizeFormula(input)).toBe(`'${input}`);
  });

  it('leaves ordinary text alone', () => {
    expect(neutralizeFormula('hello = world')).toBe('hello = world');
    expect(neutralizeFormula('')).toBe('');
  });

  it('joins a record with commas, without a line ending', () => {
    expect(csvRecord(['1', csvField('a,b'), ''])).toBe('1,"a,b",');
  });

  it('writes typed cells: numbers keep their sign, text is neutralised, null is empty', () => {
    expect(csvCell(-5, true)).toBe('-5');
    expect(csvCell('-5', true)).toBe('-5');
    expect(csvCell('-5', false)).toBe("'-5");
    expect(csvCell('=HYPERLINK("x")', false)).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(true, false)).toBe('true');
    expect(csvCell(null, false)).toBe('');
    expect(csvCell(undefined, true)).toBe('');
  });
});
