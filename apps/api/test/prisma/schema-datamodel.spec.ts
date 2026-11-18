import { join } from 'node:path';

import { Prisma } from '@prisma/client';

import { readSchemaDatamodel } from '@marinoscar/platform-api/testing';

// The schema reader behind the `userOwnedData` conformance suite (#688; moved
// to @marinoscar/platform-api/testing by #699, where its parsing rules are
// pinned). This app-side spec is the one thing the package cannot prove: that
// the reader agrees with this app's generated client on the real schema.

const SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema');

describe('schema reader vs the generated client', () => {
  it('agrees with the generated client on every model and field of the real schema', () => {
    const parsed = readSchemaDatamodel(SCHEMA_PATH);
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
