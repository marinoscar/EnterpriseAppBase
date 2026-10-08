// The purge planner (#743): delete order from the schema's relations.

import { parsePrismaSchema } from '../../src/testing/index';
import {
  UserDataPlanError,
  backRelationFields,
  delegateName,
  orderForDeletion,
  selfUnlinkFields,
} from '../../src/user-data/purge/purge-planner';

const SCHEMA = `
model User {
  id String @id
}
model Workout {
  id     String @id
  userId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  sets   WorkoutSet[]
  entries ActivityEntry[]
}
model WorkoutSet {
  id        String @id
  workoutId String
  workout   Workout @relation(fields: [workoutId], references: [id], onDelete: Cascade)
}
model ActivityEntry {
  id        String @id
  workoutId String?
  workout   Workout? @relation(fields: [workoutId], references: [id], onDelete: Cascade)
}
model Exercise {
  id      String @id
  usedBy  WorkoutExercise[]
}
model WorkoutExercise {
  id         String @id
  exerciseId String
  exercise   Exercise @relation(fields: [exerciseId], references: [id], onDelete: Restrict)
}
model Note {
  id      String @id
  photoId String?
  photo   Photo? @relation(fields: [photoId], references: [id], onDelete: SetNull)
}
model Photo {
  id    String @id
  notes Note[]
}
model Measurement {
  id           String @id
  supersedesId String?
  supersedes   Measurement? @relation("Chain", fields: [supersedesId], references: [id], onDelete: Restrict)
  supersededBy Measurement[] @relation("Chain")
}
model Loop {
  id      String @id
  otherId String
  other   Other @relation(fields: [otherId], references: [id], onDelete: Restrict)
  others  Other[] @relation("Back")
}
model Other {
  id     String @id
  loopId String
  loop   Loop @relation("Back", fields: [loopId], references: [id], onDelete: Restrict)
  loops  Loop[]
}
`;

const datamodel = parsePrismaSchema(SCHEMA);

describe('orderForDeletion', () => {
  it('puts a Restrict child before its parent, whatever order the models are given in', () => {
    expect(orderForDeletion(['Exercise', 'WorkoutExercise'], datamodel)).toEqual(['WorkoutExercise', 'Exercise']);
    expect(orderForDeletion(['WorkoutExercise', 'Exercise'], datamodel)).toEqual(['WorkoutExercise', 'Exercise']);
  });

  it('puts a Cascade child before its parent, so its rows are counted before the cascade would take them', () => {
    expect(orderForDeletion(['Workout', 'ActivityEntry', 'WorkoutSet'], datamodel)).toEqual(['ActivityEntry', 'WorkoutSet', 'Workout']);
  });

  it('puts no constraint on a SetNull relation and breaks ties by name', () => {
    expect(orderForDeletion(['Photo', 'Note'], datamodel)).toEqual(['Note', 'Photo']);
    expect(orderForDeletion(['Note', 'Photo'], datamodel)).toEqual(['Note', 'Photo']);
  });

  it('ignores relations to models outside the set', () => {
    expect(orderForDeletion(['Workout'], datamodel)).toEqual(['Workout']);
  });

  it('throws on a cycle, naming its models', () => {
    expect(() => orderForDeletion(['Loop', 'Other'], datamodel)).toThrow(UserDataPlanError);
    expect(() => orderForDeletion(['Loop', 'Other', 'Note'], datamodel)).toThrow(/cycle among Loop, Other/);
  });

  it('throws for a model the schema lacks', () => {
    expect(() => orderForDeletion(['Ghost'], datamodel)).toThrow(/no model Ghost/);
  });
});

describe('selfUnlinkFields and backRelationFields', () => {
  it('unlinks a nullable self-restrict before the rows go', () => {
    expect(selfUnlinkFields('Measurement', datamodel)).toEqual(['supersedesId']);
    expect(selfUnlinkFields('Workout', datamodel)).toEqual([]);
  });

  it('refuses a required self-restrict', () => {
    const required = parsePrismaSchema(`
model Node {
  id       String @id
  parentId String
  parent   Node @relation("Tree", fields: [parentId], references: [id], onDelete: Restrict)
  children Node[] @relation("Tree")
}`);
    expect(() => selfUnlinkFields('Node', required)).toThrow(/required self-relation/);
  });

  it('lists the list back-relations of a model', () => {
    expect(backRelationFields('Exercise', datamodel)).toEqual(['usedBy']);
    expect(backRelationFields('Workout', datamodel)).toEqual(['sets', 'entries']);
  });

  it('names Prisma delegates', () => {
    expect(delegateName('AiRun')).toBe('aiRun');
    expect(delegateName('UserAiKey')).toBe('userAiKey');
  });
});
