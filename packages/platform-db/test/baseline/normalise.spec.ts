import { describe, expect, it } from 'vitest';
import { normaliseSql, normalisedSha256, normaliseStatement, splitStatements } from '../../src/baseline/index.js';

describe('normaliseSql', () => {
  it('strips line and block comments and collapses whitespace', () => {
    const a = '-- CreateTable\nCREATE TABLE "t" (\n    "id" UUID NOT NULL\n);\n';
    const b = '/* header\n   spanning lines */\nCREATE   TABLE "t"   ("id" UUID NOT NULL); -- trailing\n';
    expect(normaliseSql(a)).toBe(normaliseSql(b));
  });

  it('lower-cases keywords but keeps quoted identifiers and literals exactly', () => {
    expect(normaliseSql('ALTER TABLE "Users" ADD COLUMN "Name" TEXT DEFAULT \'It\'\'s -- not a comment\';')).toBe(
      'alter table "Users" add column "Name" text default \'It\'\'s -- not a comment\';',
    );
    expect(normaliseSql('SELECT "User"')).not.toBe(normaliseSql('SELECT "user"'));
  });

  it('keeps a dollar-quoted body verbatim', () => {
    const sql = 'DO $$ BEGIN -- keep\n  PERFORM 1;  END $$;';
    expect(normaliseSql(sql)).toBe('do $$ BEGIN -- keep\n  PERFORM 1;  END $$;');
  });

  it('still tells apart statements that really differ', () => {
    expect(normaliseSql('ALTER TABLE "a" ADD COLUMN "x" TEXT;')).not.toBe(normaliseSql('ALTER TABLE "a" ADD COLUMN "y" TEXT;'));
    expect(normalisedSha256(Buffer.from('SELECT 1;'))).toBe(normalisedSha256(Buffer.from('select   1; -- one\n')));
  });
});

describe('statements of a diff', () => {
  it('normalises "public". qualifiers and padding', () => {
    expect(normaliseStatement('ALTER TABLE "public"."push_subscriptions" ADD COLUMN     "platform" TEXT;')).toBe(
      'ALTER TABLE "push_subscriptions" ADD COLUMN "platform" TEXT;',
    );
  });

  it('splits a script into statements and drops the headings', () => {
    const script = '-- AlterTable\nALTER TABLE "a" ADD COLUMN "x" TEXT;\n\n-- CreateIndex\nCREATE INDEX "i" ON "a"("x");\n';
    expect(splitStatements(script)).toEqual(['ALTER TABLE "a" ADD COLUMN "x" TEXT;', 'CREATE INDEX "i" ON "a"("x");']);
  });

  it('reads an empty migration as no statements', () => {
    expect(splitStatements('-- This is an empty migration.\n')).toEqual([]);
    expect(splitStatements('')).toEqual([]);
  });
});
