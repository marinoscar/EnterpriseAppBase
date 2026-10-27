// =============================================================================
// CSV cell helpers shared by every file export (from EvoPath
// `common/export/csv.ts`: telemetry #535, health #191; packaged by #744)
// =============================================================================
//
// RFC 4180: fields joined by `,`, records by CRLF, a field holding `"`, `,`,
// CR or LF is quoted and its quotes doubled. Files start with a UTF-8 BOM so
// Excel detects the encoding.
//
// FORMULA INJECTION. A text cell a spreadsheet would read as a formula
// (`=`, `+`, `-`, `@`, tab, CR) is prefixed with `'`. Exported text can be
// user- or attacker-controlled (a note, a file name, a log line), and CSV
// injection is the classic way to turn one into code on the reader's
// machine. Callers leave numeric columns alone, so `-5` stays `-5`.
//
// FRAMEWORK-FREE: no Nest, no Node stream, so a script or the browser-side
// data table can use the same rules.
// =============================================================================

/**
 * The UTF-8 byte order mark, as the one character it encodes. Written once at
 * the start of each CSV file.
 *
 * @example
 * ```ts
 * const header = UTF8_BOM + csvRecord(['id', 'name']) + '\r\n';
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export const UTF8_BOM = '﻿';

/**
 * What a spreadsheet treats as the start of a formula: `=`, `+`, `-`, `@`, a
 * tab or a carriage return.
 *
 * @stability stable
 */
export const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * The record separator RFC 4180 prescribes.
 *
 * @stability stable
 */
export const CSV_LINE_END = '\r\n';

/**
 * One field, quoted when RFC 4180 requires it (a `"`, `,`, CR or LF inside),
 * with its quotes doubled.
 *
 * @param text - the field's text.
 * @returns the field as it goes into a record.
 *
 * @example
 * ```ts
 * csvField('a,b'); // '"a,b"'
 * csvField('say "hi"'); // '"say ""hi"""'
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * `text` prefixed with `'` when a spreadsheet would read it as a formula.
 * Apply it to text cells only; numbers keep their sign.
 *
 * @param text - a text cell.
 * @returns the neutralised text.
 *
 * @example
 * ```ts
 * neutralizeFormula('=HYPERLINK("x")'); // "'=HYPERLINK(\"x\")"
 * neutralizeFormula('hello'); // 'hello'
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export function neutralizeFormula(text: string): string {
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

/**
 * One CSV record, without its line ending.
 *
 * @param fields - the already-quoted fields ({@link csvField}).
 * @returns the fields joined by `,`.
 *
 * @example
 * ```ts
 * csvRecord(['1', csvField('a,b')]) + CSV_LINE_END; // '1,"a,b"\r\n'
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export function csvRecord(fields: readonly string[]): string {
  return fields.join(',');
}

/**
 * One typed value as a CSV field: `null` is empty, a number or boolean is its
 * text, and any other text is formula-neutralised unless `numeric` says the
 * column holds numbers, then quoted as needed.
 *
 * @param value - the cell.
 * @param numeric - whether the column is numeric (never neutralised).
 * @returns the field.
 *
 * @example
 * ```ts
 * csvCell('-5', true); // '-5'
 * csvCell('-5', false); // "'-5"
 * csvCell(null, false); // ''
 * ```
 *
 * @stability stable
 */
export function csvCell(value: string | number | boolean | null | undefined, numeric: boolean): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return csvField(numeric ? value : neutralizeFormula(value));
}
