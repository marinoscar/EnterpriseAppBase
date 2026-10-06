import { Prisma } from '@prisma/client';

import {
  effectiveOnDelete,
  parsePrismaSchema,
  readSchemaDatamodel,
  stripLineComment,
} from './schema-datamodel';

// The schema reader behind the ownership tripwire (#688).

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

describe('schema-datamodel', () => {
  it('strips comments outside string literals only', () => {
    expect(stripLineComment('a String // comment')).toBe('a String ');
    expect(stripLineComment('a String @default("http://x") // c')).toBe('a String @default("http://x") ');
    expect(stripLineComment('/// doc')).toBe('');
    expect(stripLineComment('a String @default("say \\"//\\"")')).toBe('a String @default("say \\"//\\"")');
  });

  it('reads models and skips enums, generators, comments and block attributes', () => {
    const models = parsePrismaSchema(SAMPLE);
    expect(models.map((m) => m.name)).toEqual(['User', 'Post']);
    expect(models[1].fields.map((f) => f.name)).toEqual([
      'id',
      'title',
      'authorId',
      'editorId',
      'tags',
      'author',
      'editor',
    ]);
  });

  it('reads field types, lists and optionality', () => {
    const post = parsePrismaSchema(SAMPLE)[1];
    const byName = Object.fromEntries(post.fields.map((f) => [f.name, f]));
    expect(byName.tags).toMatchObject({ type: 'String', isList: true, isOptional: false });
    expect(byName.editorId).toMatchObject({ type: 'String', isList: false, isOptional: true });
    expect(byName.title.relation).toBeUndefined();
  });

  it('reads relation names, foreign keys and onDelete', () => {
    const [user, post] = parsePrismaSchema(SAMPLE);
    const author = post.fields.find((f) => f.name === 'author');
    const editor = post.fields.find((f) => f.name === 'editor');

    expect(author?.relation).toEqual({ name: 'Authored', fields: ['authorId'], references: ['id'], onDelete: 'Cascade' });
    expect(editor?.relation).toEqual({ name: 'Edited', fields: ['editorId'], references: ['id'] });
    expect(user.fields.find((f) => f.name === 'posts')?.relation).toEqual({ name: 'Authored', fields: [], references: [] });
  });

  it("applies Prisma's default onDelete when none is written", () => {
    const post = parsePrismaSchema(SAMPLE)[1];
    const field = (name: string) => post.fields.find((f) => f.name === name)!;
    expect(effectiveOnDelete(field('author'))).toBe('Cascade');
    expect(effectiveOnDelete(field('editor'))).toBe('SetNull');
    expect(effectiveOnDelete({ ...field('editor'), isOptional: false })).toBe('Restrict');
  });

  it('agrees with the generated client on every model and field of the real schema', () => {
    const parsed = readSchemaDatamodel();
    const generated = Prisma.dmmf.datamodel.models;

    expect(parsed.map((m) => m.name)).toEqual(generated.map((m) => m.name));
    for (const model of generated) {
      const mine = parsed.find((m) => m.name === model.name)!;
      // The generated datamodel carries only name, kind, type and relationName.
      expect(mine.fields.map((f) => [f.name, f.type])).toEqual(model.fields.map((f) => [f.name, f.type]));
      for (const field of model.fields.filter((f) => f.kind === 'object')) {
        const relation = mine.fields.find((f) => f.name === field.name)?.relation;
        if (relation?.name !== undefined) expect(relation.name).toBe(field.relationName);
      }
    }
  });
});
