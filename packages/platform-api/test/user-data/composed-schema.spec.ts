// Finding the composed schema folder (#880).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composedSchemaDatamodel, findComposedSchemaPath } from '../../src/user-data/index';

describe('composedSchemaDatamodel', () => {
  const root = mkdtempSync(join(tmpdir(), 'composed-schema-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('walks up to prisma/schema and parses it, once asked', () => {
    mkdirSync(join(root, 'prisma', 'schema'), { recursive: true });
    writeFileSync(join(root, 'prisma', 'schema', 'a.prisma'), 'model User {\n  id String @id\n}\n');
    mkdirSync(join(root, 'dist', 'platform', 'user-data'), { recursive: true });
    const from = join(root, 'dist', 'platform', 'user-data');

    expect(findComposedSchemaPath(from)).toBe(join(root, 'prisma', 'schema'));
    expect(composedSchemaDatamodel(from)().map((model) => model.name)).toEqual(['User']);
  });

  it('names the starting directory when there is none', () => {
    const empty = mkdtempSync(join(tmpdir(), 'no-schema-'));
    try {
      expect(() => findComposedSchemaPath(empty)).toThrow(/cannot find prisma\/schema above/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
