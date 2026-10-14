// CSV helpers of the telemetry export (issue #703). The same rules as the
// app's `common/export/csv.ts` (#689): RFC 4180 quoting, a UTF-8 BOM, and a
// leading `'` on a cell a spreadsheet would read as a formula. Copied so the
// telemetry slice imports no app code; `internal.spec.ts` pins the same
// values the app's copy has. Internal to the slice: not exported.

/** The UTF-8 byte order mark, as the one character it encodes. */
export const UTF8_BOM = '\uFEFF';

/** What a spreadsheet treats as the start of a formula. */
export const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** One field, quoted when RFC 4180 requires it. */
export function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** `text` prefixed with `'` when a spreadsheet would read it as a formula. */
export function neutralizeFormula(text: string): string {
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}
