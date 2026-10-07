import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { effectiveOnDelete, parsePrismaSchema, readSchemaDatamodel, readSchemaText } from '../../src/testing';
import { stripLineComment } from '../../src/testing/prisma-schema';

// The schema reader behind the `user-owned-data` suite (#688, moved by #699).
// The reference app proves it agrees with its generated client on the real
// schema (apps/api/test/prisma/schema-datamodel.spec.ts).

const SAMPLE = `
// A leading comment with a model User { inside it
generator client {
  provider = "prisma-client-js"
}

enum Colour {
  red
  blue
}

/// Doc comment
model User {
  id     String  @id @default(uuid()) @db.Uuid
  avatar String? @default("https://example.test/a.png") // a comment after a // in a string
  posts  Post[]  @relation("Authored")
  edits  Post[]  @relation("Edited")
}

model Post {
  id         String  @id
  title      String  // not a relation: @relation(fields: [x])
  authorId   String  @map("author_id")
  editorId   String?
  tags       String[]
  author     User    @relation("Authored", fields: [authorId], references: [id], onDelete: Cascade)
  editor     User?   @relation(name: "Edited", fields: [editorId], references: [id])

  @@index([authorId])
  @@map("posts")
}
`;

describe('prisma-schema', () => {
  it('strips comments outside string literals only', () => {
    expect(stripLineComment('a String // comment')).toBe('a String ');
    expect(stripLineComment('a String @default("http://x") // c')).toBe('a String @default("http://x") ');
    expect(stripLineComment('/// doc')).toBe('');
    expect(stripLineComment('a String @default("say \\"//\\"")')).toBe('a String @default("say \\"//\\"")');
  });

  it('reads models and skips enums, generators, comments and block attributes', () => {
    const models = parsePrismaSchema(SAMPLE);
    expect(models.map((m) => m.name)).toEqual(['User', 'Post']);
    expect(models[1]!.fields.map((f) => f.name)).toEqual(['id', 'title', 'authorId', 'editorId', 'tags', 'author', 'editor']);
  });

  it('reads field types, lists and optionality', () => {
    const post = parsePrismaSchema(SAMPLE)[1]!;
    const byName = Object.fromEntries(post.fields.map((f) => [f.name, f]));
    expect(byName.tags).toMatchObject({ type: 'String', isList: true, isOptional: false });
    expect(byName.editorId).toMatchObject({ type: 'String', isList: false, isOptional: true });
    expect(byName.title!.relation).toBeUndefined();
  });

  it('reads relation names, foreign keys and onDelete', () => {
    const [user, post] = parsePrismaSchema(SAMPLE);
    const author = post!.fields.find((f) => f.name === 'author');
    const editor = post!.fields.find((f) => f.name === 'editor');

    expect(author?.relation).toEqual({ name: 'Authored', fields: ['authorId'], references: ['id'], onDelete: 'Cascade' });
    expect(editor?.relation).toEqual({ name: 'Edited', fields: ['editorId'], references: ['id'] });
    expect(user!.fields.find((f) => f.name === 'posts')?.relation).toEqual({ name: 'Authored', fields: [], references: [] });
  });

  it("applies Prisma's default onDelete when none is written", () => {
    const post = parsePrismaSchema(SAMPLE)[1]!;
    const field = (name: string) => post.fields.find((f) => f.name === name)!;
    expect(effectiveOnDelete(field('author'))).toBe('Cascade');
    expect(effectiveOnDelete(field('editor'))).toBe('SetNull');
    expect(effectiveOnDelete({ ...field('editor'), isOptional: false })).toBe('Restrict');
  });

  it('reads one file, or every *.prisma file of a folder in name order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prisma-schema-'));
    try {
      writeFileSync(join(dir, 'b.prisma'), 'model B {\n  id String @id\n}\n');
      writeFileSync(join(dir, 'a.prisma'), 'model A {\n  id String @id\n}\n');
      writeFileSync(join(dir, 'notes.md'), 'model C {\n}\n');
      expect(readSchemaDatamodel(dir).map((m) => m.name)).toEqual(['A', 'B']);
      expect(readSchemaText(join(dir, 'b.prisma'))).toContain('model B');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
