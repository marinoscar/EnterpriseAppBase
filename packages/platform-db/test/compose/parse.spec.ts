import { describe, expect, it } from 'vitest';

import { ComposeError } from '../../src/compose/errors.js';
import { isExtensible, parseBlocks, parseBody } from '../../src/compose/parse.js';

const SRC = `// banner
// @extensible
model User {
  id    String @id
  email String @unique
  // about items
  items Item[]

  @@map("users")
}

enum Color {
  RED
}

extend model User {
  more More[]
}
`;

describe('parseBlocks', () => {
  it('splits top-level blocks and keeps the comment run above each as leading text', () => {
    const { blocks } = parseBlocks(SRC, 'f.prisma');
    expect(blocks.map((b) => [b.extend ? 'extend' : 'decl', b.kind, b.name, b.line])).toEqual([
      ['decl', 'model', 'User', 3],
      ['decl', 'enum', 'Color', 12],
      ['extend', 'model', 'User', 16],
    ]);
    expect(blocks[0]?.leading).toBe('// banner\n// @extensible');
  });

  it('reads @extensible only from the comment run directly above the model', () => {
    const [user, color] = parseBlocks(SRC, 'f.prisma').blocks;
    expect(isExtensible(user!)).toBe(true);
    expect(isExtensible(color!)).toBe(false);
    const { blocks } = parseBlocks('// @extensible\n\nmodel Late {\n}\n', 'f.prisma');
    expect(isExtensible(blocks[0]!)).toBe(false);
  });

  it('lists fields with their 1-based file line and block attributes separately', () => {
    const user = parseBlocks(SRC, 'f.prisma').blocks[0]!;
    const { fields, attrs } = parseBody(user, 'f.prisma');
    expect(fields.map((f) => [f.name, f.type, f.line])).toEqual([
      ['id', 'String', 4],
      ['email', 'String', 5],
      ['items', 'Item', 7],
    ]);
    expect(attrs.map((a) => [a.raw.trim(), a.line])).toEqual([['@@map("users")', 9]]);
  });

  it('keeps text after the last block as trailing', () => {
    expect(parseBlocks('model A {\n}\n// the end\n', 'f.prisma').trailing).toBe('// the end\n');
  });

  it.each([
    ['a header split over two lines', 'model User\n{\n}\n', 1, /prisma format shape/],
    ['an indented header', '  model User {\n  }\n', 1, /column 0/],
    ['a block never closed', 'model User {\n  id String\n', 1, /not closed/],
    ['a closing brace with no block', 'model A {\n}\n}\n', 3, /no open block/],
  ])('rejects %s as MALFORMED with file and line', (_name, src, line, message) => {
    let error: unknown;
    try {
      parseBlocks(src, 'bad.prisma');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ComposeError);
    const err = error as ComposeError;
    expect([err.code, err.file, err.line]).toEqual(['MALFORMED', 'bad.prisma', line]);
    expect(err.message).toMatch(new RegExp(`^bad\\.prisma:${line}: MALFORMED: `));
    expect(err.detail).toMatch(message);
  });
});
