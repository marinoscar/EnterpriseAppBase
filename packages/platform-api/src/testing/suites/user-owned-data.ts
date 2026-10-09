// =============================================================================
// Suite: user-owned data is registered, and raw SQL is allowlisted
// (issue #688, moved to the harness by #699)
// =============================================================================
//
// Two tripwires around scoped data access (`@marinoscar/platform-api/core`,
// "Scoped data access"), moved here UNCHANGED from the reference app's
// apps/api/test/prisma/{user-owned-models,raw-sql-allowlist}.spec.ts:
//
//   1. Registry vs schema. Fails when a model gains a relation to `User`
//      without a user-owned registry entry; when an entry names a model, field
//      or exportOmit column that does not exist, or a field that is not a
//      foreign key to `User`; when a purge policy contradicts the relation's
//      `onDelete` ('delete' ⇔ Cascade, 'detach' ⇔ SetNull, 'retain' ⇔
//      Restrict/NoAction); when an owner relation is not where `ownerRelation`
//      points; or when an actor field on an owned model cascades.
//   2. Raw SQL. Raw SQL bypasses the scoped client, so every non-spec source
//      file using `$queryRaw`, `$queryRawUnsafe`, `$executeRaw` or
//      `$executeRawUnsafe` (outside comments and string literals) must be on
//      the app's allowlist with a reason, and every allowlisted file must
//      still use raw SQL.
//
// The app keeps the DATA: its registrations (passed as `policies`), its schema
// path and its allowlist.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { ownerRelationOf } from '../../core/index';
import type { UserOwnedModelDef } from '../../core/index';
import type {
  ConformanceCase,
  ConformanceContext,
  ConformanceFinding,
  ConformanceReport,
  ConformanceSuite,
} from '../conformance-suite';
import { effectiveOnDelete, readSchemaDatamodel, type DatamodelField, type DatamodelModel } from '../prisma-schema';

/**
 * How an app configures the user-owned data suite.
 *
 * @example
 * ```ts
 * const options: UserOwnedDataOptions = {
 *   schemaPath: join(__dirname, '..', '..', 'prisma', 'schema'),
 *   policies: userOwnedModelRegistry.list(),
 *   rawSqlAllowlist: [{ file: 'health/database.indicator.ts', why: 'Health probe: SELECT 1.' }],
 *   registerIn: 'src/app-registrations/user-owned-models.ts',
 * };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface UserOwnedDataOptions {
  /** Absolute path to the app's `schema.prisma`, or to a folder of `*.prisma` files (a composed schema). */
  schemaPath: string;
  /** The app's registry contents: import the module that fills it, then pass `userOwnedModelRegistry.list()`. */
  policies: readonly UserOwnedModelDef[];
  /**
   * Files allowed to issue raw SQL, as paths relative to the source root that
   * contains them (`/` separators), each with a non-empty reason. The suite
   * fails for an allowlisted file that no longer uses raw SQL (or is gone).
   */
  rawSqlAllowlist: ReadonlyArray<{
    /** The file, relative to its source root, with `/` separators. */
    file: string;
    /** Why it needs raw SQL, and why no request-derived id reaches it unscoped. */
    why: string;
  }>;
  /** The model whose foreign keys mark ownership. Default `'User'`. */
  userModel?: string;
  /**
   * Where the fix goes, completing "Register `Model.field` in ...", for
   * example `'src/app-registrations/user-owned-models.ts'`. Default: "the
   * user-owned data registry".
   */
  registerIn?: string;
}

/** The `onDelete` values each purge policy accepts. */
const PURGE_ON_DELETE: Readonly<Record<UserOwnedModelDef['purge'], readonly string[]>> = {
  delete: ['Cascade'],
  detach: ['SetNull'],
  retain: ['Restrict', 'NoAction'],
};

// -----------------------------------------------------------------------------
// Check 1: registry vs schema
// -----------------------------------------------------------------------------

/** Every relation to `userModel` that holds the foreign key on this side, keyed by FK field name. */
function userForeignKeys(model: DatamodelModel, userModel: string): Map<string, DatamodelField> {
  const keys = new Map<string, DatamodelField>();
  for (const field of model.fields) {
    if (field.type !== userModel || !field.relation) continue;
    for (const fk of field.relation.fields) keys.set(fk, field);
  }
  return keys;
}

/**
 * Every disagreement between the registered definitions and the datamodel.
 * An empty array means the registry is complete and consistent. Pure.
 *
 * @internal
 */
export function checkUserOwnedModels(
  datamodel: readonly DatamodelModel[],
  defs: readonly UserOwnedModelDef[],
  options: { userModel?: string; registerIn?: string } = {},
): string[] {
  const userModel = options.userModel ?? 'User';
  const registerIn = options.registerIn ?? 'the user-owned data registry';
  const registerHint = (model: string, field: string) =>
    `Register ${model}.${field} in ${registerIn}, with a purge and export policy.`;

  const problems: string[] = [];
  const models = new Map(datamodel.map((model) => [model.name, model]));
  const registered = new Map<string, UserOwnedModelDef>(defs.map((def) => [def.model, def]));

  // 1. Every User foreign key is registered.
  for (const model of datamodel) {
    for (const fk of userForeignKeys(model, userModel).keys()) {
      const def = registered.get(model.name);
      const fields = def ? [def.ownerField, ...(def.actorFields ?? [])] : [];
      if (!fields.includes(fk)) {
        problems.push(`${model.name}.${fk} is a foreign key to ${userModel} with no registry entry. ${registerHint(model.name, fk)}`);
      }
    }
  }

  // 2. Every registered model and field exists, and its policy matches onDelete.
  for (const def of defs) {
    const model = models.get(def.model);
    if (!model) {
      problems.push(`${def.model} is registered but schema.prisma has no such model. Remove or rename the entry.`);
      continue;
    }

    const scalars = new Set(model.fields.filter((field) => !field.relation).map((field) => field.name));
    const foreignKeys = userForeignKeys(model, userModel);

    const checkField = (field: string, role: 'owner' | 'actor'): DatamodelField | undefined => {
      if (!scalars.has(field)) {
        problems.push(`${def.model}.${field} is registered as the ${role} field but schema.prisma has no such column.`);
        return undefined;
      }
      const relation = foreignKeys.get(field);
      if (!relation) {
        problems.push(`${def.model}.${field} is registered as the ${role} field but is not a foreign key to ${userModel}.`);
      }
      return relation;
    };

    const checkPurge = (field: string, relation: DatamodelField) => {
      const onDelete = effectiveOnDelete(relation);
      const accepted = PURGE_ON_DELETE[def.purge];
      if (!accepted.includes(onDelete)) {
        problems.push(
          `${def.model}.${field}: purge '${def.purge}' requires onDelete ${accepted.join(' or ')}, but schema.prisma has ${onDelete} (relation ${relation.name}).`,
        );
      }
    };

    if (def.ownerField !== undefined) {
      const relation = checkField(def.ownerField, 'owner');
      if (relation) {
        checkPurge(def.ownerField, relation);
        const expected = ownerRelationOf(def);
        if (relation.name !== expected) {
          problems.push(
            `${def.model}.${def.ownerField}: the owner relation field is "${relation.name}", not "${expected}". Set ownerRelation: '${relation.name}'.`,
          );
        }
      }
    }

    for (const field of def.actorFields ?? []) {
      const relation = checkField(field, 'actor');
      if (!relation) continue;
      if (def.ownerField === undefined) {
        checkPurge(field, relation);
      } else if (effectiveOnDelete(relation) === 'Cascade') {
        problems.push(
          `${def.model}.${field}: an actor field on an owned model cannot be onDelete Cascade: deleting the actor would delete a row another user owns.`,
        );
      }
    }

    for (const column of def.exportOmit ?? []) {
      if (!scalars.has(column)) {
        problems.push(`${def.model}.exportOmit names "${column}", which schema.prisma does not have.`);
      }
    }
  }

  return problems;
}

// -----------------------------------------------------------------------------
// Check 2: raw SQL only in allowlisted files
// -----------------------------------------------------------------------------

const RAW_SQL = /\$(?:queryRaw|executeRaw)(?:Unsafe)?\b/g;

/**
 * Replaces the contents of comments and of `'...'`/`"..."` strings with
 * spaces, keeping line breaks. Template literals are kept: a raw call is a tag
 * written before one, never inside it.
 *
 * @internal
 */
export function blankCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (ch === '`') {
      // Copied through, so a quote inside a template never starts a string.
      let j = i + 1;
      while (j < source.length && source[j] !== '`') j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      out += ' '.repeat(Math.min(j + 1, source.length) - i);
      i = j + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * The raw SQL methods a source file uses, outside comments and strings.
 *
 * @internal
 */
export function rawSqlUses(source: string): string[] {
  return [...new Set(blankCommentsAndStrings(source).match(RAW_SQL) ?? [])].sort();
}

/** Every `.ts` file under `dir`, excluding tests. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

/**
 * One finding per unlisted file, per stale allowlist entry and per entry
 * without a reason. Pure.
 *
 * @param found - every file using raw SQL, relative path → methods.
 * @internal
 */
export function checkRawSqlAllowlist(
  found: ReadonlyMap<string, readonly string[]>,
  allowlist: UserOwnedDataOptions['rawSqlAllowlist'],
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const listed = new Set(allowlist.map((entry) => entry.file));
  for (const [file, uses] of found) {
    if (!listed.has(file)) {
      findings.push({
        file,
        message: `uses ${uses.join(', ')}: add it to the raw-SQL allowlist with a reason, and make sure it never runs with request-derived ids unscoped.`,
      });
    }
  }
  for (const entry of allowlist) {
    if (!found.has(entry.file)) {
      findings.push({ file: entry.file, message: 'is in the raw-SQL allowlist but no longer uses raw SQL (or no longer exists): remove the entry.' });
    }
    if (entry.why.trim() === '') findings.push({ file: entry.file, message: 'the raw-SQL allowlist entry needs a reason.' });
  }
  return findings;
}

// -----------------------------------------------------------------------------
// The suite
// -----------------------------------------------------------------------------

/** The `file` of every registry finding: the schema's own name (never a `.ts` path). */
function schemaLabel(options: UserOwnedDataOptions): string {
  return basename(options.schemaPath);
}

/** Runs both scans; see {@link userOwnedDataSuite}. */
function check(context: ConformanceContext, options: UserOwnedDataOptions): ConformanceReport {
  if (context.sourceRoots.length === 0) {
    throw new Error('user-owned-data: sourceRoots is empty, so there is nothing to scan.');
  }

  let datamodel: DatamodelModel[];
  try {
    datamodel = readSchemaDatamodel(options.schemaPath);
  } catch (cause) {
    throw new Error(`user-owned-data: cannot read the schema at ${options.schemaPath}: ${(cause as Error).message}`);
  }

  const userModel = options.userModel ?? 'User';
  const label = schemaLabel(options);
  const registryFindings = checkUserOwnedModels(datamodel, options.policies, {
    userModel,
    ...(options.registerIn !== undefined ? { registerIn: options.registerIn } : {}),
  }).map((message): ConformanceFinding => ({ file: label, message }));

  const found = new Map<string, string[]>();
  let scannedSources = 0;
  for (const root of context.sourceRoots) {
    let files: string[];
    try {
      files = sourceFiles(root);
    } catch (cause) {
      throw new Error(`user-owned-data: cannot read source root ${root}: ${(cause as Error).message}`);
    }
    for (const file of files) {
      scannedSources += 1;
      const uses = rawSqlUses(readFileSync(file, 'utf8'));
      if (uses.length > 0) found.set(relative(root, file).split('\\').join('/'), uses);
    }
  }

  const ownedModels = datamodel.filter((model) => userForeignKeys(model, userModel).size > 0);

  return {
    scanned: {
      models: datamodel.length,
      userForeignKeyModels: ownedModels.length,
      sourceFiles: scannedSources,
      rawSqlFiles: found.size,
    },
    scannedFiles: { rawSqlFiles: [...found.keys()] },
    findings: [...registryFindings, ...checkRawSqlAllowlist(found, options.rawSqlAllowlist)],
  };
}

/** The tests the harness registers for this suite. */
function cases(options: UserOwnedDataOptions): ReadonlyArray<ConformanceCase> {
  const label = schemaLabel(options);
  const describe = (finding: ConformanceFinding) => `${finding.file}: ${finding.message}`;
  return [
    {
      // The failure this guards: the schema moves, the parse finds nothing,
      // and every case below passes over an empty datamodel.
      name: 'reads the schema and the sources at all, so a broken scan cannot pass vacuously',
      run: (report, expect) => {
        expect(report.scanned.userForeignKeyModels).toBeGreaterThanOrEqual(1);
        expect(report.scanned.sourceFiles).toBeGreaterThanOrEqual(1);
      },
    },
    {
      name: 'registers every User foreign key, with purge policies that match onDelete',
      run: (report, expect) => {
        expect(report.findings.filter((finding) => finding.file === label).map(describe)).toEqual([]);
      },
    },
    {
      name: 'issues raw SQL only from allowlisted files, each with a reason',
      run: (report, expect) => {
        expect(report.findings.filter((finding) => finding.file !== label).map(describe)).toEqual([]);
      },
    },
  ];
}

/**
 * The suite behind `runPlatformConformance({ suites: { userOwnedData } })`:
 * every foreign key to `User` is registered with policies that match the
 * schema, and raw SQL appears only in allowlisted files.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const userOwnedDataSuite: ConformanceSuite<UserOwnedDataOptions> = {
  id: 'user-owned-data',
  title: 'user-owned data is registered and raw SQL is allowlisted',
  description:
    'Every foreign key to User has a user-owned registry entry whose purge policy matches onDelete, and only allowlisted files issue raw SQL.',
  check,
  cases,
};
