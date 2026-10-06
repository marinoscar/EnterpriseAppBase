// =============================================================================
// A minimal reader for the prisma/schema/ folder's models and relations (#688)
// =============================================================================
//
// WHY PARSE THE FILE: the ownership tripwire needs each relation's foreign
// key fields and `onDelete`. Prisma 7's generated client still exports
// `Prisma.dmmf.datamodel`, but its relation fields carry only `name`, `kind`,
// `type` and `relationName`: no `relationFromFields`, no `relationOnDelete`.
// The schema file is the only place they are written down, and specs already
// read it (test/ai/ai-user-keys.integration.spec.ts).
//
// Deliberately small: models, their fields, and `@relation(...)` arguments.
// Enums, views, generators, datasources and block attributes (`@@...`) are
// skipped. schema-datamodel.spec.ts pins what it understands.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A relation's arguments, as written in `@relation(...)`. */
export interface DatamodelRelation {
  /** The relation name, when one is given (`@relation("Name", ...)` or `name: "Name"`). */
  readonly name?: string;
  /** Foreign key fields on this side; empty on the back-relation side. */
  readonly fields: readonly string[];
  readonly references: readonly string[];
  /** The `onDelete` written in the schema, if any. See {@link effectiveOnDelete}. */
  readonly onDelete?: string;
}

export interface DatamodelField {
  readonly name: string;
  /** The type name without `?` or `[]`: `String`, `User`, `Role`... */
  readonly type: string;
  readonly isList: boolean;
  readonly isOptional: boolean;
  /** Present when the field has a `@relation(...)` attribute. */
  readonly relation?: DatamodelRelation;
}

export interface DatamodelModel {
  readonly name: string;
  readonly fields: readonly DatamodelField[];
}

/**
 * Path of the schema the generated client is built from: the folder of
 * `*.prisma` files that `platform db compose` writes (a multi-file schema).
 */
export const SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema');

/** Removes a `//` comment (including `///` doc comments), ignoring `//` inside a string literal. */
export function stripLineComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && inString) {
      i += 1;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString && ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

function listArgument(args: string, key: string): string[] {
  const match = new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(args);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseRelation(attributes: string): DatamodelRelation | undefined {
  const match = /@relation\(([^)]*)\)/.exec(attributes);
  if (!match) {
    return /@relation\b/.test(attributes) ? { fields: [], references: [] } : undefined;
  }
  const args = match[1];
  const named = /\bname\s*:\s*"([^"]*)"/.exec(args) ?? /^\s*"([^"]*)"/.exec(args);
  const onDelete = /\bonDelete\s*:\s*(\w+)/.exec(args);
  return {
    ...(named ? { name: named[1] } : {}),
    fields: listArgument(args, 'fields'),
    references: listArgument(args, 'references'),
    ...(onDelete ? { onDelete: onDelete[1] } : {}),
  };
}

/** Parses the models of a Prisma schema. */
export function parsePrismaSchema(source: string): DatamodelModel[] {
  const models: DatamodelModel[] = [];
  let current: { name: string; fields: DatamodelField[] } | undefined;
  let otherBlock = false;

  for (const raw of source.split(/\r?\n/)) {
    const line = stripLineComment(raw).trim();
    if (line === '') continue;

    if (current === undefined && !otherBlock) {
      const model = /^model\s+(\w+)\s*\{$/.exec(line);
      if (model) {
        current = { name: model[1], fields: [] };
      } else if (/^\w+\s+\w+\s*\{$/.test(line)) {
        otherBlock = true; // enum, view, type, generator, datasource
      }
      continue;
    }

    if (line === '}') {
      if (current) models.push(current);
      current = undefined;
      otherBlock = false;
      continue;
    }

    if (otherBlock || current === undefined || line.startsWith('@@')) continue;

    const field = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
    if (!field) continue;
    const relation = parseRelation(field[5]);
    current.fields.push({
      name: field[1],
      type: field[2],
      isList: field[3] === '[]',
      isOptional: field[4] === '?',
      ...(relation ? { relation } : {}),
    });
  }

  return models;
}

/**
 * The text of a schema: one file, or every `*.prisma` file of a folder in
 * name order (the order Prisma loads them, which is the order of the
 * generated client's models).
 */
export function readSchemaText(path: string = SCHEMA_PATH): string {
  if (!statSync(path).isDirectory()) return readFileSync(path, 'utf8');
  return readdirSync(path)
    .filter((name) => name.endsWith('.prisma'))
    .sort()
    .map((name) => readFileSync(join(path, name), 'utf8'))
    .join('\n');
}

/** The models of the schema at {@link SCHEMA_PATH} (a file or a folder). */
export function readSchemaDatamodel(path: string = SCHEMA_PATH): DatamodelModel[] {
  return parsePrismaSchema(readSchemaText(path));
}

/**
 * The referential action Postgres actually applies: the one written, or
 * Prisma's default (`SetNull` for an optional relation, `Restrict` for a
 * required one).
 */
export function effectiveOnDelete(field: DatamodelField): string {
  return field.relation?.onDelete ?? (field.isOptional ? 'SetNull' : 'Restrict');
}
