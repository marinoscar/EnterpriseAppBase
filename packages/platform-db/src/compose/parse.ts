// A deliberately small, line-oriented reader for `prisma format`-shaped schema
// text. It is NOT a Prisma parser (no Prisma-internal dependency: those APIs
// are unstable). It relies on two properties `prisma format` guarantees and
// that every fragment must keep; the composer rejects a file that breaks them:
//   1. a block header is `<kind> <Name> {` on ONE line, at column 0;
//   2. a block ends with `}` alone on a line, at column 0.
// Comments and blank lines between blocks are kept as the NEXT block's
// "leading" text, so a banner or a doc comment travels with its model.

import { ComposeError } from './errors.js';

/** @internal */
export type BlockKind = 'model' | 'enum' | 'type' | 'view' | 'generator' | 'datasource';

/** @internal */
export interface Block {
  /** `extend model X { ... }` rather than a declaration. */
  extend: boolean;
  kind: BlockKind;
  name: string;
  /** Comments and blank lines between the previous block and this one. */
  leading: string;
  /** Header line, body lines and the closing `}`. */
  lines: string[];
  /** 1-based line of the header. */
  line: number;
}

/** @internal */
export interface Field {
  name: string;
  /** The type name without `[]`, `?` or arguments. */
  type: string;
  /** Everything after the type (attributes and trailing comment). */
  attrs: string;
  /** The line exactly as written. */
  raw: string;
  /** 1-based line in the file. */
  line: number;
}

const KINDS = 'model|enum|type|view|generator|datasource';
const HEADER = new RegExp(`^(?:(extend)\\s+)?(${KINDS})\\s+([A-Za-z_]\\w*)\\s*\\{\\s*$`);
const LOOSE_HEADER = new RegExp(`^\\s*(?:extend\\s+)?(?:${KINDS})\\s+\\w+\\s*(?:\\{.*)?$`);
const FIELD = /^\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(?:\([^)]*\))?(?:\[\])?\??(\s.*)?$/;

/**
 * Splits one fragment into top-level blocks.
 *
 * @param src - File contents.
 * @param file - Path to name in errors.
 * @returns The blocks in file order and the text after the last block.
 * @throws {@link ComposeError} `MALFORMED` for a header or footer that is not `prisma format` shaped.
 * @internal
 */
export function parseBlocks(src: string, file: string): { blocks: Block[]; trailing: string } {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let acc: string[] = [];
  let cur: Block | null = null;
  lines.forEach((text, i) => {
    const lineNo = i + 1;
    if (!cur) {
      const m = HEADER.exec(text);
      if (m) {
        cur = {
          extend: m[1] === 'extend',
          kind: m[2] as BlockKind,
          name: m[3] as string,
          leading: acc.join('\n'),
          lines: [text],
          line: lineNo,
        };
        acc = [];
      } else if (LOOSE_HEADER.test(text)) {
        throw new ComposeError(
          'MALFORMED',
          file,
          lineNo,
          `a block header must be "<kind> <Name> {" on one line at column 0 (prisma format shape), got: ${text.trim()}`,
        );
      } else if (text.trim() === '}') {
        throw new ComposeError('MALFORMED', file, lineNo, 'a "}" with no open block');
      } else {
        acc.push(text);
      }
    } else {
      cur.lines.push(text);
      if (text === '}') {
        blocks.push(cur);
        cur = null;
      }
    }
  });
  if (cur) {
    const open: Block = cur;
    throw new ComposeError(
      'MALFORMED',
      file,
      open.line,
      `block "${open.name}" is not closed by a "}" alone at column 0`,
    );
  }
  return { blocks, trailing: acc.join('\n') };
}

/**
 * Is the block marked `// @extensible` in the comment run directly above it?
 *
 * @internal
 */
export function isExtensible(block: Block): boolean {
  const above = block.leading.split('\n');
  for (let i = above.length - 1; i >= 0; i--) {
    const text = (above[i] as string).trim();
    if (text === '') break;
    if (/^\/\/\s*@extensible\b/.test(text)) return true;
  }
  return false;
}

/**
 * The fields and block attributes of a model body.
 *
 * @internal
 */
export function parseBody(block: Block, file: string): { fields: Field[]; attrs: Array<{ raw: string; line: number }> } {
  const fields: Field[] = [];
  const attrs: Array<{ raw: string; line: number }> = [];
  block.lines.slice(1, -1).forEach((raw, i) => {
    const line = block.line + 1 + i;
    const t = raw.trim();
    if (t === '' || t.startsWith('//')) return;
    if (t.startsWith('@@')) {
      attrs.push({ raw, line });
      return;
    }
    const m = FIELD.exec(raw);
    if (!m) {
      throw new ComposeError('MALFORMED', file, line, `cannot read a field in ${block.name}: ${t}`);
    }
    fields.push({ name: m[1] as string, type: m[2] as string, attrs: m[3] ?? '', raw, line });
  });
  return { fields, attrs };
}

/**
 * The block as text, with its leading comments.
 *
 * @internal
 */
export function renderBlock(block: Pick<Block, 'leading' | 'lines'>): string {
  return `${block.leading ? `${block.leading}\n` : ''}${block.lines.join('\n')}`;
}
