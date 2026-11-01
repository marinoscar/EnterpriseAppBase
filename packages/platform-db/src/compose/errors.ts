/**
 * Stable code of a composer rejection. Every code is listed in the rule table
 * of the database ADR (docs/adr/0002-database-packaging-and-rls.md, D2).
 *
 * @stability experimental
 */
export type ComposeErrorCode =
  | 'NOT_EXTENSIBLE'
  | 'UNKNOWN_MODEL'
  | 'FIELD_COLLISION'
  | 'EXTEND_SCALAR_FIELD'
  | 'EXTEND_OWNING_RELATION'
  | 'EXTEND_BLOCK_ATTRIBUTE'
  | 'EXTEND_UNKNOWN_TYPE'
  | 'DUPLICATE_MODEL'
  | 'DUPLICATE_BASE'
  | 'MALFORMED';

/**
 * A rejected fragment. The message always starts with `file:line: CODE:` so an
 * editor or a CI annotation can jump to the offending line.
 *
 * @stability experimental
 */
export class ComposeError extends Error {
  /** The stable rule code (for example `NOT_EXTENSIBLE`). */
  readonly code: ComposeErrorCode;
  /** The fragment file the problem is in, as the caller supplied its path. */
  readonly file: string;
  /** 1-based line of the offending block header or field. */
  readonly line: number;
  /** The explanation without the `file:line: CODE:` prefix. */
  readonly detail: string;

  /**
   * @param code - The rule that was broken.
   * @param file - The fragment file.
   * @param line - 1-based line in that file.
   * @param detail - What is wrong and how to fix it.
   */
  constructor(code: ComposeErrorCode, file: string, line: number, detail: string) {
    super(`${file}:${line}: ${code}: ${detail}`);
    this.name = 'ComposeError';
    this.code = code;
    this.file = file;
    this.line = line;
    this.detail = detail;
  }
}
