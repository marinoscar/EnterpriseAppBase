// =============================================================================
// The sharing slice's conformance suite (issue #732, PP-7.5)
// =============================================================================
//
// The sharing invariants, checked against the APP that consumes the package
// (spec: "Conformance suites travel with packages"). Importing
// `@marinoscar/platform-api/sharing/testing` registers the `sharing` suite
// with `runPlatformConformance()`.
//
//   1. no-direct-access: no app source file touches the sharing tables
//      directly (`prisma.grant`, `.group`, `.groupMember`, `.groupInvite`, or
//      `grants`, `groups`, `group_members`, `group_invites` in raw SQL). Apps
//      go through the exported services and helpers. Same scanning technique
//      as the reference app's `ai-no-sdk-leak.spec.ts`.
//   2. group-ownership-registered: every model of the composed schema with an
//      `owner_group_id` column maps to a resource type registered as
//      group-owned (`registerResourceType` with group ownership, or a direct
//      `registerGroupOwnedResource`), so deleting a group can never orphan
//      its rows.
//   3. link-routes-guarded: every route reachable from the app's root module
//      that carries `@LinkGrantResource` is behind `LinkGrantGuard` (and the
//      other way round), names a type that grants a role to links, and, with
//      the app's public-marker reader, is deliberately public; the slice's
//      own routes are public only on the link pattern. Routes are read from
//      Nest metadata, as the identity suite does.
//   4. raw-sql-indexes: the three partial unique indexes the slice relies on
//      exist in the app's migration SQL.
//   5. resource-type-ids-stable: the registered resource type ids equal the
//      app's committed snapshot. Removing an id that has grant rows is a
//      breaking change, like a job type string.
//
// Everything is synchronous: one scan (`check`), five cases over its report.
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { conformanceSuites, readSchemaText } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { resourceTypeRegistry } from '../access/resource-types';
import { LINK_GRANT_RESOURCE_KEY } from '../links/link-grant.decorators';
import { LinkGrantGuard } from '../links/link-grant.guard';
import { ANY_LINK_RESOURCE_TYPE, type LinkResolutionExpectation } from '../links/link-grants.service';
import { groupOwnedResourceRegistry } from '../ownership';
import { SharingModule } from '../sharing.module';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The sharing slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/sharing/testing`. */
    sharing?: SharingConformanceOptions | false;
  }
}

/**
 * The five checks of the `sharing` suite, by id.
 *
 * @stability experimental
 */
export type SharingConformanceCheck =
  | 'no-direct-access'
  | 'group-ownership-registered'
  | 'link-routes-guarded'
  | 'raw-sql-indexes'
  | 'resource-type-ids-stable';

/**
 * One violation, tagged with the check that found it.
 *
 * @stability experimental
 */
export interface SharingConformanceFinding extends ConformanceFinding {
  /** The check that found it. */
  readonly check: SharingConformanceCheck;
}

/**
 * What an app passes as `suites.sharing` to `runPlatformConformance()`: its
 * data, never its code.
 *
 * @example
 * ```ts
 * import '@marinoscar/platform-api/sharing/testing';
 *
 * runPlatformConformance({
 *   sourceRoots: [API_SOURCE_ROOT],
 *   suites: {
 *     sharing: {
 *       schemaPath: join(API_ROOT, 'prisma', 'schema'),
 *       migrationsDir: join(API_ROOT, 'prisma', 'migrations'),
 *       rootModule: AppModule,
 *       isPublic: (target) => Reflect.getMetadata(IS_PUBLIC_KEY, target) === true,
 *       groupOwnedModels: { Album: 'album' },
 *       resourceTypeIds: ['album', 'transcript'],
 *     },
 *   },
 * });
 * ```
 *
 * @stability experimental
 */
export interface SharingConformanceOptions {
  /**
   * Absolute directories scanned by check 1 (non-test `.ts` files). Default:
   * the harness's `sourceRoots`.
   */
  readonly apiSourceRoots?: readonly string[];
  /**
   * Files check 1 lets through, relative to their source root (`/`
   * separators), each with the reason. A stale entry fails the check.
   */
  readonly directAccessExempt?: Readonly<Record<string, string>>;
  /** The composed Prisma schema: a `.prisma` file or a folder of them (`prisma/schema/`). */
  readonly schemaPath: string;
  /** The app's migrations folder (`prisma/migrations/`), read recursively for `migration.sql` files. */
  readonly migrationsDir: string;
  /**
   * Prisma model name to the resource type registered as group-owned for it,
   * for every model with an `owner_group_id` column (check 2).
   */
  readonly groupOwnedModels?: Readonly<Record<string, string>>;
  /** The app's root module; every controller reachable from it is walked (check 3). */
  readonly rootModule: Type<unknown> | DynamicModule;
  /**
   * Reads the app's deliberately-public marker on a handler or a controller
   * class (the reference app: `Reflect.getMetadata(IS_PUBLIC_KEY, target) === true`).
   * Without it, check 3 does not judge publicness.
   */
  readonly isPublic?: (target: object) => boolean;
  /**
   * The committed snapshot of the app's resource type ids (check 5). A type
   * id is permanent once grants of it exist.
   */
  readonly resourceTypeIds: readonly string[];
  /** Fewest routes the walk must find (a vacuity guard). Default 1. */
  readonly minRoutes?: number;
}

/** The partial unique indexes the slice relies on (they exist only in migration SQL). */
export const SHARING_RAW_SQL_INDEXES: readonly string[] = Object.freeze([
  'grants_active_user_uniq_idx',
  'grants_active_group_uniq_idx',
  'group_invites_pending_uniq_idx',
]);

const DELEGATES = ['grant', 'group', 'groupMember', 'groupInvite'] as const;
const METHODS =
  'findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany|count|aggregate|groupBy';
const DELEGATE_USE = new RegExp(`\\.\\s*(${DELEGATES.join('|')})\\s*\\.\\s*(${METHODS})\\s*\\(`, 'g');
/** What precedes a raw-SQL literal: a `$queryRaw`/`$executeRaw`/`sql` tag, or an `*Unsafe(` call. */
const RAW_SQL_TAG = /(?:\$(?:queryRaw|executeRaw)|\bsql)\s*$/;
const RAW_SQL_UNSAFE_CALL = /\$(?:queryRaw|executeRaw)Unsafe\s*\(\s*$/;
const RAW_TABLE_USE = /\b(from|join|into|update|table)\s+(?:"?public"?\.)?"?(grants|groups|group_members|group_invites)"?(?![\w"])/gi;

/** Blanks `//` and block comments, keeping line breaks (strings and templates stay: raw SQL lives there). */
function blankComments(source: string): string {
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
    } else if (ch === '`' || ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * The string and template literals of `source` that are raw SQL: a template
 * tagged `$queryRaw`, `$executeRaw` or `sql` (`Prisma.sql`), or the first
 * argument of `$queryRawUnsafe(` / `$executeRawUnsafe(`. Prose in other strings
 * ("remove them from groups") is never read as SQL.
 */
function rawSqlLiterals(source: string): Array<{ start: number; text: string }> {
  const out: Array<{ start: number; text: string }> = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch !== '`' && ch !== "'" && ch !== '"') continue;
    let j = i + 1;
    while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1;
    const before = source.slice(Math.max(0, i - 40), i);
    if ((ch === '`' && RAW_SQL_TAG.test(before)) || RAW_SQL_UNSAFE_CALL.test(before)) out.push({ start: i, text: source.slice(i, j + 1) });
    i = j;
  }
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** Every non-test `.ts` file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return /\.ts$/.test(entry) && !/\.(spec|test|d)\.ts$/.test(entry) ? [path] : [];
  });
}

const toPosix = (path: string): string => path.split(sep).join('/');

/**
 * Check 1: the files under `roots` that touch the sharing tables directly.
 *
 * @param roots - absolute source directories.
 * @param exempt - files let through (relative to their root), with the reason.
 * @returns the findings and the number of files scanned.
 * @throws Error when a root does not exist.
 *
 * @stability experimental
 */
export function checkNoDirectSharingAccess(
  roots: readonly string[],
  exempt: Readonly<Record<string, string>> = {},
): { findings: SharingConformanceFinding[]; files: number } {
  const findings: SharingConformanceFinding[] = [];
  const used = new Set<string>();
  let files = 0;
  for (const root of roots) {
    if (!existsSync(root)) throw new Error(`sharing conformance: source root ${root} does not exist`);
    for (const path of sourceFiles(root)) {
      files += 1;
      const file = toPosix(relative(root, path));
      const source = blankComments(readFileSync(path, 'utf8'));
      const hits: string[] = [];
      for (const match of source.matchAll(DELEGATE_USE)) {
        hits.push(`line ${lineOf(source, match.index)}: \`.${match[1]}.${match[2]}()\``);
      }
      for (const literal of rawSqlLiterals(source)) {
        for (const match of literal.text.matchAll(RAW_TABLE_USE)) {
          hits.push(`line ${lineOf(source, literal.start + match.index)}: raw SQL on \`${match[2]}\``);
        }
      }
      if (hits.length === 0) continue;
      if (exempt[file] !== undefined) {
        used.add(file);
        continue;
      }
      findings.push({
        check: 'no-direct-access',
        file,
        message:
          `${hits.join(', ')} touches the sharing tables directly. Go through the slice: AccessPolicy (one record), ` +
          'accessibleWhere / accessibleSql / sharedResourceIds (lists; accessibleSql is the only sanctioned raw-SQL path to grants), ' +
          'GrantsService (share, revoke, deleteForResources in a delete transaction), GroupsService and GroupMembershipService (groups). ' +
          'Exempt the file in directAccessExempt only with a reason.',
      });
    }
  }
  for (const file of Object.keys(exempt)) {
    if (!used.has(file)) {
      findings.push({ check: 'no-direct-access', file, message: 'is in directAccessExempt but no longer touches the sharing tables: remove the stale entry.' });
    }
  }
  return { findings, files };
}

/**
 * The models of a Prisma schema that have an `owner_group_id` column
 * (`@map("owner_group_id")`, or a field of that name).
 *
 * @param schemaPath - a `.prisma` file or a folder of them.
 * @returns the model names, in schema order.
 *
 * @stability experimental
 */
export function modelsWithOwnerGroupColumn(schemaPath: string): { models: string[]; withColumn: string[] } {
  const text = readSchemaText(schemaPath)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const models: string[] = [];
  const withColumn: string[] = [];
  for (const match of text.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
    const [, name, body] = match as unknown as [string, string, string];
    models.push(name);
    if (/@map\(\s*"owner_group_id"\s*\)/.test(body) || /^\s*owner_group_id\s/m.test(body)) withColumn.push(name);
  }
  return { models, withColumn };
}

/**
 * Check 2: every `owner_group_id` model maps to a registered group-owned type.
 *
 * @param schemaPath - the composed schema.
 * @param groupOwnedModels - model name to resource type id.
 * @param registered - the group-owned resource type ids (default: the registry).
 * @returns the findings and what the schema holds.
 *
 * @stability experimental
 */
export function checkGroupOwnershipRegistered(
  schemaPath: string,
  groupOwnedModels: Readonly<Record<string, string>> = {},
  registered: readonly string[] = groupOwnedResourceRegistry.list().map((def) => def.type),
): { findings: SharingConformanceFinding[]; models: number; withColumn: number } {
  const { models, withColumn } = modelsWithOwnerGroupColumn(schemaPath);
  const findings: SharingConformanceFinding[] = [];
  const known = new Set(registered);
  for (const model of withColumn) {
    const type = groupOwnedModels[model];
    if (type === undefined) {
      findings.push({
        check: 'group-ownership-registered',
        file: `model ${model}`,
        message:
          "has an owner_group_id column but no group-owned resource type: register one (registerResourceType({ ownership: 'group' | 'user_or_group', countOwnedByGroup, ... }), " +
          "or registerGroupOwnedResource({ type, countOwnedByGroup }) when the rows are never shared) and map the model to it in groupOwnedModels. " +
          'Otherwise deleting a group would orphan its rows.',
      });
    } else if (!known.has(type)) {
      findings.push({
        check: 'group-ownership-registered',
        file: `model ${model}`,
        message: `maps to resource type "${type}", which is not registered as group-owned: register it (registerResourceType with group ownership, or registerGroupOwnedResource) before the suite runs.`,
      });
    }
  }
  for (const [model, type] of Object.entries(groupOwnedModels)) {
    if (!models.includes(model)) {
      findings.push({ check: 'group-ownership-registered', file: `model ${model}`, message: `is in groupOwnedModels (-> "${type}") but not in the schema: remove the stale entry.` });
    } else if (!withColumn.includes(model)) {
      findings.push({ check: 'group-ownership-registered', file: `model ${model}`, message: `is in groupOwnedModels (-> "${type}") but has no owner_group_id column: remove the entry or add the column.` });
    }
  }
  return { findings, models: models.length, withColumn: withColumn.length };
}

/**
 * One route the walk found, with what check 3 needs.
 *
 * @stability experimental
 */
export interface SharingRoute {
  /** `ControllerName#handler`. */
  readonly id: string;
  /** Whether the controller was mounted by `SharingModule.forRoot()`. */
  readonly fromSlice: boolean;
  /** The `@LinkGrantResource` expectation, if any (handler, then class). */
  readonly linkResource?: LinkResolutionExpectation;
  /** Whether `LinkGrantGuard` (or a subclass) guards it. */
  readonly linkGuarded: boolean;
  /** The app's public marker, when the reader was given. */
  readonly isPublic?: boolean;
}

type ImportLike = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

const isDynamic = (value: unknown): value is DynamicModule => typeof value === 'object' && value !== null && 'module' in value;
const isForwardRef = (value: unknown): value is ForwardReference => typeof value === 'object' && value !== null && 'forwardRef' in value;

/**
 * Every route reachable from `root` (static and dynamic module imports, each
 * module once), with its link metadata and guards.
 *
 * @param root - the app's root module.
 * @param isPublic - the app's public-marker reader, if any.
 * @returns the routes, in discovery order.
 *
 * @stability experimental
 */
export function discoverSharingRoutes(root: Type<unknown> | DynamicModule, isPublic?: (target: object) => boolean): SharingRoute[] {
  const seen = new Set<unknown>();
  const controllers: Array<{ controller: Type<unknown>; fromSlice: boolean }> = [];
  const visit = (entry: ImportLike | undefined): void => {
    if (!entry || entry instanceof Promise) return;
    const resolved = isForwardRef(entry) ? (entry.forwardRef() as ImportLike) : entry;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    const moduleClass = isDynamic(resolved) ? resolved.module : (resolved as Type<unknown>);
    const fromSlice = moduleClass === SharingModule;
    const own = [
      ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleClass) ?? []) as Array<Type<unknown>>),
      ...(isDynamic(resolved) ? (resolved.controllers ?? []) : []),
    ];
    for (const controller of own) {
      if (!controllers.some((known) => known.controller === controller)) controllers.push({ controller, fromSlice });
    }
    const children = [
      ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ?? []) as ImportLike[]),
      ...((isDynamic(resolved) ? (resolved.imports ?? []) : []) as ImportLike[]),
    ];
    for (const child of children) visit(child);
  };
  visit(root);

  const isLinkGuard = (guard: unknown): boolean =>
    typeof guard === 'function' && (guard === LinkGrantGuard || guard.prototype instanceof LinkGrantGuard);
  const routes: SharingRoute[] = [];
  for (const { controller, fromSlice } of controllers) {
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
    const classLink = Reflect.getMetadata(LINK_GRANT_RESOURCE_KEY, controller) as LinkResolutionExpectation | undefined;
    const prototype = controller.prototype as Record<string, unknown>;
    const names = new Set<string>();
    for (let proto: object | null = prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
    }
    for (const name of names) {
      if (name === 'constructor') continue;
      const handler = prototype[name];
      if (typeof handler !== 'function') continue;
      if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[])];
      const linkResource = (Reflect.getMetadata(LINK_GRANT_RESOURCE_KEY, handler) as LinkResolutionExpectation | undefined) ?? classLink;
      routes.push({
        id: `${controller.name}#${name}`,
        fromSlice,
        ...(linkResource ? { linkResource } : {}),
        linkGuarded: guards.some(isLinkGuard),
        ...(isPublic ? { isPublic: isPublic(handler) || isPublic(controller) } : {}),
      });
    }
  }
  return routes;
}

/**
 * Check 3: link routes are guarded, declared, servable and deliberately public.
 *
 * @param routes - from {@link discoverSharingRoutes}.
 * @returns the findings.
 *
 * @stability experimental
 */
export function checkLinkRoutesGuarded(routes: readonly SharingRoute[]): SharingConformanceFinding[] {
  const findings: SharingConformanceFinding[] = [];
  const push = (file: string, message: string): void => void findings.push({ check: 'link-routes-guarded', file, message });
  for (const route of routes) {
    if (route.linkResource && !route.linkGuarded) {
      push(
        route.id,
        'declares @LinkGrantResource but is not behind LinkGrantGuard: the metadata alone authenticates nothing, so the route is public with no link check. Add @UseGuards(LinkGrantGuard) to the controller or the handler.',
      );
    }
    if (route.linkGuarded && !route.linkResource) {
      push(route.id, 'is behind LinkGrantGuard without @LinkGrantResource(type, { action }): the guard fails closed (500) on every request. Declare the resource type and action the route serves.');
    }
    const type = route.linkResource?.resourceType;
    if (type && type !== ANY_LINK_RESOURCE_TYPE) {
      const def = resourceTypeRegistry.get(type);
      if (!def) {
        push(route.id, `serves links of "${type}", which is not a registered resource type: every request would be a 404. Register it with registerResourceType before the suite runs.`);
      } else if ((def.grantable?.link ?? []).length === 0) {
        push(route.id, `serves links of "${type}", whose type lists no role under grantable.link: no link of it can exist. Add grantable: { link: [...] } to the type.`);
      }
    }
    if (route.isPublic === undefined) continue;
    if (route.linkGuarded && !route.isPublic) {
      push(route.id, "is behind LinkGrantGuard but carries no public marker: add the app's @Public(), so the route inventory (and the identity suite) sees it as deliberately public.");
    }
    if (route.fromSlice && route.isPublic && !route.linkGuarded) {
      push(route.id, 'is a public route of the sharing slice outside the link pattern: the only sharing routes without @Auth() are the link routes behind LinkGrantGuard.');
    }
  }
  return findings;
}

/** Every `migration.sql` under `dir`, as one text. */
function migrationsText(dir: string): { files: number; text: string } {
  if (!existsSync(dir)) throw new Error(`sharing conformance: migrations folder ${dir} does not exist`);
  const walk = (path: string): string[] =>
    statSync(path).isDirectory() ? readdirSync(path).sort().flatMap((entry) => walk(join(path, entry))) : path.endsWith('.sql') ? [path] : [];
  const files = walk(dir);
  return { files: files.length, text: files.map((file) => readFileSync(file, 'utf8')).join('\n') };
}

/**
 * Check 4: the slice's partial unique indexes exist in the migration SQL.
 *
 * @param migrationsDir - the app's migrations folder.
 * @param indexes - the names to find (default {@link SHARING_RAW_SQL_INDEXES}).
 * @returns the findings and the number of SQL files read.
 *
 * @stability experimental
 */
export function checkSharingRawSqlIndexes(
  migrationsDir: string,
  indexes: readonly string[] = SHARING_RAW_SQL_INDEXES,
): { findings: SharingConformanceFinding[]; files: number } {
  const { files, text } = migrationsText(migrationsDir);
  const findings: SharingConformanceFinding[] = [];
  for (const name of indexes) {
    const pattern = new RegExp(`CREATE\\s+UNIQUE\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${name}"?(?![\\w])`, 'i');
    if (!pattern.test(text)) {
      findings.push({
        check: 'raw-sql-indexes',
        file: `index ${name}`,
        message:
          `is missing from the migrations under ${toPosix(migrationsDir)}. It exists only in migration SQL (Prisma cannot express a partial unique index): ` +
          'install the sharing migrations (npm run db:sync, then prisma:migrate), and never replace it with @@unique or a findFirst pre-check.',
      });
    }
  }
  return { findings, files };
}

/**
 * Check 5: the registered resource type ids equal the committed snapshot.
 *
 * @param snapshot - the app's committed ids.
 * @param registered - the registered ids (default: the registry).
 * @returns the findings.
 *
 * @stability experimental
 */
export function checkResourceTypeIdsStable(
  snapshot: readonly string[],
  registered: readonly string[] = resourceTypeRegistry.list().map((def) => def.type),
): SharingConformanceFinding[] {
  const findings: SharingConformanceFinding[] = [];
  for (const id of snapshot) {
    if (!registered.includes(id)) {
      findings.push({
        check: 'resource-type-ids-stable',
        file: `resource type ${id}`,
        message:
          'is in the snapshot but no longer registered. A resource type id is permanent once grants of it exist, like a job type string: ' +
          'removing or renaming it orphans every grant row of that type (a breaking change). Re-register it; remove it from the snapshot only ' +
          'in the change that proves no grant of the type exists (or migrates them).',
      });
    }
  }
  for (const id of registered) {
    if (!snapshot.includes(id)) {
      findings.push({
        check: 'resource-type-ids-stable',
        file: `resource type ${id}`,
        message: 'is registered but not in the snapshot: add it to resourceTypeIds (the id is permanent once grants of it exist).',
      });
    }
  }
  return findings;
}

/** The findings of one check. */
function of(report: ConformanceReport, check: SharingConformanceCheck): ConformanceFinding[] {
  return report.findings.filter((finding) => (finding as SharingConformanceFinding).check === check);
}

/**
 * The `sharing` conformance suite. Registered when
 * `@marinoscar/platform-api/sharing/testing` is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const sharingConformanceSuite: ConformanceSuite<SharingConformanceOptions> = {
  id: 'sharing',
  title: 'the sharing slice keeps its invariants',
  description:
    'No app file touches the sharing tables directly, every owner_group_id model is a registered group-owned resource, every link route is behind LinkGrantGuard, the raw-SQL indexes exist and resource type ids never disappear.',
  check(context, options): ConformanceReport {
    const direct = checkNoDirectSharingAccess(options.apiSourceRoots ?? context.sourceRoots, options.directAccessExempt);
    const ownership = checkGroupOwnershipRegistered(options.schemaPath, options.groupOwnedModels);
    const routes = discoverSharingRoutes(options.rootModule, options.isPublic);
    const links = checkLinkRoutesGuarded(routes);
    if (routes.length < (options.minRoutes ?? 1)) {
      links.unshift({
        check: 'link-routes-guarded',
        file: 'routes',
        message: `the walk found ${routes.length} route(s), fewer than ${options.minRoutes ?? 1}: is rootModule the app's root module?`,
      });
    }
    const indexes = checkSharingRawSqlIndexes(options.migrationsDir);
    const ids = checkResourceTypeIdsStable(options.resourceTypeIds);
    if (direct.files === 0) {
      direct.findings.unshift({ check: 'no-direct-access', file: 'sourceRoots', message: 'hold no .ts file: the scan would be vacuous.' });
    }
    return {
      scanned: {
        sourceFiles: direct.files,
        models: ownership.models,
        ownerGroupModels: ownership.withColumn,
        routes: routes.length,
        linkRoutes: routes.filter((route) => route.linkGuarded || route.linkResource).length,
        migrationFiles: indexes.files,
        resourceTypes: resourceTypeRegistry.list().length,
      },
      scannedFiles: { linkRoutes: routes.filter((route) => route.linkGuarded || route.linkResource).map((route) => route.id) },
      findings: [...direct.findings, ...ownership.findings, ...links, ...indexes.findings, ...ids],
    };
  },
  cases(): ConformanceCase[] {
    return [
      {
        name: 'no-direct-access: no app file reads or writes the grants and groups tables directly',
        run: (report, expect) => expect(of(report, 'no-direct-access')).toEqual([]),
      },
      {
        name: 'group-ownership-registered: every owner_group_id model is a registered group-owned resource',
        run: (report, expect) => expect(of(report, 'group-ownership-registered')).toEqual([]),
      },
      {
        name: 'link-routes-guarded: every @LinkGrantResource route is behind LinkGrantGuard and deliberately public',
        run: (report, expect) => expect(of(report, 'link-routes-guarded')).toEqual([]),
      },
      {
        name: 'raw-sql-indexes: the sharing partial unique indexes are in the migration SQL',
        run: (report, expect) => expect(of(report, 'raw-sql-indexes')).toEqual([]),
      },
      {
        name: 'resource-type-ids-stable: the registered resource type ids equal the snapshot',
        run: (report, expect) => expect(of(report, 'resource-type-ids-stable')).toEqual([]),
      },
    ];
  },
};

if (!conformanceSuites.has(sharingConformanceSuite.id)) conformanceSuites.register(sharingConformanceSuite);
