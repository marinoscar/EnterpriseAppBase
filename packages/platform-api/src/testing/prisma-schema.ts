// =============================================================================
// A minimal reader for a Prisma schema's models and relations (#688, moved to
// the testing slice by #699)
// =============================================================================
//
// WHY PARSE THE FILE: the `userOwnedData` suite needs each relation's foreign
// key fields and `onDelete`. Prisma 7's generated client still exports
// `Prisma.dmmf.datamodel`, but its relation fields carry only `name`, `kind`,
// `type` and `relationName`: no `relationFromFields`, no `relationOnDelete`.
// The schema file is the only place they are written down. Parsing it also
// keeps this package free of any generated client and of `@prisma/internals`.
//
// Deliberately small: models, their fields, and `@relation(...)` arguments.
// Enums, views, generators, datasources and block attributes (`@@...`) are
// skipped. `extend model` blocks are not read (the app's composed schema has
// none). The package's spec pins what it understands; the reference app's
// apps/api/test/prisma/schema-datamodel.spec.ts proves it agrees with the
// generated client on the real schema.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A relation's arguments, as written in `@relation(...)`.
 *
 * @stability experimental
 */
export interface DatamodelRelation {
  /** The relation name, when one is given (`@relation("Name", ...)` or `name: "Name"`). */
  readonly name?: string;
  /** Foreign key fields on this side; empty on the back-relation side. */
  readonly fields: readonly string[];
  /** The referenced fields on the other model. */
  readonly references: readonly string[];
  /** The `onDelete` written in the schema, if any. See {@link effectiveOnDelete}. */
  readonly onDelete?: string;
}

/**
 * One field of a parsed model.
 *
 * @stability experimental
 */
export interface DatamodelField {
  /** The field name. */
  readonly name: string;
  /** The type name without `?` or `[]`: `String`, `User`, `Role`... */
  readonly type: string;
  /** Whether the type ends in `[]`. */
  readonly isList: boolean;
  /** Whether the type ends in `?`. */
  readonly isOptional: boolean;
  /** Present when the field has a `@relation(...)` attribute. */
  readonly relation?: DatamodelRelation;
}

/**
 * One parsed model.
 *
 * @stability experimental
 */
export interface DatamodelModel {
  /** The model name. */
  readonly name: string;
  /** Its fields, in schema order. */
  readonly fields: readonly DatamodelField[];
}

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
  return match[1]!
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseRelation(attributes: string): DatamodelRelation | undefined {
  const match = /@relation\(([^)]*)\)/.exec(attributes);
  if (!match) {
    return /@relation\b/.test(attributes) ? { fields: [], references: [] } : undefined;
  }
  const args = match[1]!;
  const named = /\bname\s*:\s*"([^"]*)"/.exec(args) ?? /^\s*"([^"]*)"/.exec(args);
  const onDelete = /\bonDelete\s*:\s*(\w+)/.exec(args);
  return {
    ...(named ? { name: named[1]! } : {}),
    fields: listArgument(args, 'fields'),
    references: listArgument(args, 'references'),
    ...(onDelete ? { onDelete: onDelete[1]! } : {}),
  };
}

/**
 * Parses the models of a Prisma schema.
 *
 * @param source - the schema text (one file, or several joined).
 * @returns the models in schema order; enums, views, generators and datasources are skipped.
 *
 * @stability experimental
 * @example
 * ```ts
 * parsePrismaSchema('model Note {\n  id String @id\n}').map((m) => m.name); // ['Note']
 * ```
 */
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
        current = { name: model[1]!, fields: [] };
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
    const relation = parseRelation(field[5]!);
    current.fields.push({
      name: field[1]!,
      type: field[2]!,
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
 *
 * @param path - a `schema.prisma` file or a folder of `*.prisma` files.
 *
 * @stability experimental
 * @example
 * ```ts
 * const text = readSchemaText(join(__dirname, '..', '..', 'prisma', 'schema'));
 * ```
 */
export function readSchemaText(path: string): string {
  if (!statSync(path).isDirectory()) return readFileSync(path, 'utf8');
  return readdirSync(path)
    .filter((name) => name.endsWith('.prisma'))
    .sort()
    .map((name) => readFileSync(join(path, name), 'utf8'))
    .join('\n');
}

/**
 * The models of the schema at `path` (a file or a folder).
 *
 * @param path - see {@link readSchemaText}.
 *
 * @stability experimental
 * @example
 * ```ts
 * const models = readSchemaDatamodel(join(__dirname, '..', '..', 'prisma', 'schema'));
 * ```
 */
export function readSchemaDatamodel(path: string): DatamodelModel[] {
  return parsePrismaSchema(readSchemaText(path));
}

/**
 * The referential action Postgres actually applies: the one written, or
 * Prisma's default (`SetNull` for an optional relation, `Restrict` for a
 * required one).
 *
 * @param field - a relation field.
 *
 * @stability experimental
 * @example
 * ```ts
 * effectiveOnDelete({ name: 'user', type: 'User', isList: false, isOptional: true, relation: { fields: ['userId'], references: ['id'] } }); // 'SetNull'
 * ```
 */
export function effectiveOnDelete(field: DatamodelField): string {
  return field.relation?.onDelete ?? (field.isOptional ? 'SetNull' : 'Restrict');
}
