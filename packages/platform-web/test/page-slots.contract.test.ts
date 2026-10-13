/**
 * The packaged-page slot contract, enforced (PP-14.23).
 *
 * Every component this package exports from a `ui` entry point under a name that
 * ends in `Page` must take a `slots` prop whose type extends `PageSlotsBase`
 * (`src/core/page-slots.tsx`) and accepts every member of it, unless the page is
 * listed in `page-slots.exempt.json` with a reason. The list only shrinks: an
 * entry whose page now conforms, or no longer exists, fails the test, so a
 * migrated page is removed from it in the same change.
 *
 * The scan is type-level. It builds a TypeScript program over the `ui` entry
 * points of the package's `exports` map, finds the exported value components
 * named `*Page`, reads the type of the `slots` property of each one's props and
 * asks the compiler two questions: is that type assignable to `PageSlotsBase`
 * (the page's slots extend the contract), and is `PageSlotsBase` assignable to
 * it (the page accepts every slot of the contract). A failure names the page.
 *
 * The `expectTypeOf` assertions at the end pin the same relation for the
 * migrated pages at compile time (`npm run typecheck`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';

import type { PageSlotsBase, TableSlots } from '../src/core/index.js';
import type { DbBackupPageProps } from '../src/db-backup/ui/index.js';
import type { DoctorPageProps } from '../src/doctor/ui/index.js';
import type { JobInsightsPageProps, JobsPageProps } from '../src/jobs/ui/index.js';
import type { WorkersPageProps } from '../src/nodes/ui/index.js';
import type {
  TelemetryDashboardPageProps,
  TelemetryExplorerPageProps,
  TelemetrySettingsPageProps,
} from '../src/telemetry/ui/index.js';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ExemptEntry {
  page: string;
  reason: string;
}

interface PageReport {
  name: string;
  /** The `exports` subpaths that export it. */
  entries: string[];
  /** The page takes a `slots` prop at all. */
  hasSlots: boolean;
  /** The `slots` type is assignable to `PageSlotsBase`. */
  extendsBase: boolean;
  /** `PageSlotsBase` is assignable to the `slots` type: the page accepts every base slot. */
  acceptsBase: boolean;
}

const PAGE_NAME = /^[A-Z]\w*Page$/;

/** `./x/ui` -> `src/x/ui/index.ts`; only the `ui` entry points (`/ui` and `/ui/<part>`). */
function uiEntries(): { subpath: string; file: string }[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
    exports: Record<string, string | { types?: string }>;
  };
  const entries: { subpath: string; file: string }[] = [];
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (!/\/ui(\/|$)/.test(subpath)) continue;
    const types = typeof target === 'string' ? target : target.types;
    if (!types) continue;
    entries.push({ subpath, file: path.join(PACKAGE_DIR, types.replace('./dist/', 'src/').replace(/\.d\.ts$/, '.ts')) });
  }
  return entries;
}

function scanPages(): PageReport[] {
  const config = ts.readConfigFile(path.join(PACKAGE_DIR, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PACKAGE_DIR);
  const entries = uiEntries();
  const coreFile = path.join(PACKAGE_DIR, 'src/core/index.ts');
  const program = ts.createProgram([coreFile, ...entries.map((entry) => entry.file)], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  const coreSource = program.getSourceFile(coreFile);
  const coreModule = coreSource && checker.getSymbolAtLocation(coreSource);
  const baseSymbol = coreModule && checker.getExportsOfModule(coreModule).find((symbol) => symbol.getName() === 'PageSlotsBase');
  if (!baseSymbol) throw new Error('PageSlotsBase is not exported from src/core/index.ts');
  const base = checker.getDeclaredTypeOfSymbol(baseSymbol);

  const reports = new Map<string, PageReport>();
  for (const { subpath, file } of entries) {
    const source = program.getSourceFile(file);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!source || !moduleSymbol) throw new Error(`cannot read the ui entry ${subpath} (${file})`);
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const name = exported.getName();
      if (!PAGE_NAME.test(name)) continue;
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (!(symbol.flags & ts.SymbolFlags.Value)) continue;
      const signatures = checker.getTypeOfSymbolAtLocation(symbol, source).getCallSignatures();
      if (signatures.length === 0) continue; // a value named *Page that is not a component
      const existing = reports.get(name);
      if (existing) {
        existing.entries.push(subpath);
        continue;
      }
      const propsParameter = signatures[0]?.getParameters()[0];
      const props = propsParameter && checker.getTypeOfSymbolAtLocation(propsParameter, source);
      const slotsSymbol = props?.getProperty('slots');
      let extendsBase = false;
      let acceptsBase = false;
      if (slotsSymbol) {
        const slots = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(slotsSymbol, source));
        extendsBase = checker.isTypeAssignableTo(slots, base);
        acceptsBase = checker.isTypeAssignableTo(base, slots);
      }
      reports.set(name, { name, entries: [subpath], hasSlots: slotsSymbol !== undefined, extendsBase, acceptsBase });
    }
  }
  return [...reports.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readExempt(): ExemptEntry[] {
  const raw = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'test/page-slots.exempt.json'), 'utf8')) as {
    exempt: ExemptEntry[];
  };
  return raw.exempt;
}

const conforms = (page: PageReport): boolean => page.hasSlots && page.extendsBase && page.acceptsBase;

describe('the packaged-page slot contract', () => {
  let pages: PageReport[] = [];
  const exempt = readExempt();

  beforeAll(() => {
    pages = scanPages();
  }, 180_000);

  it('finds the packaged pages of the ui entry points', () => {
    const names = pages.map((page) => page.name);
    expect(names).toEqual(expect.arrayContaining(['JobsPage', 'JobInsightsPage', 'WorkersPage', 'DbBackupPage', 'DoctorPage', 'LoginPage']));
    // The same page exported from several entry points is one page.
    expect(new Set(names).size).toBe(names.length);
  });

  it('every exported *Page takes slots that extend PageSlotsBase, or is exempt with a reason', () => {
    const exemptNames = new Set(exempt.map((entry) => entry.page));
    const failing = pages.filter((page) => !conforms(page) && !exemptNames.has(page.name));
    expect(
      failing.map((page) =>
        !page.hasSlots
          ? `${page.name} (${page.entries.join(', ')}) has no \`slots\` prop`
          : `${page.name} (${page.entries.join(', ')}) has a \`slots\` prop that ${page.extendsBase ? '' : 'does not extend PageSlotsBase'}${
              !page.extendsBase && !page.acceptsBase ? ' and ' : ''
            }${page.acceptsBase ? '' : 'does not accept every member of PageSlotsBase'}`,
      ),
      'Give the page a `slots` prop typed to PageSlotsBase (see packages/platform-web/src/core/README.md, "Page slots"), or list it in test/page-slots.exempt.json with a reason.',
    ).toEqual([]);
  });

  it('every exemption has a reason and names a page that still exists and still does not conform', () => {
    const byName = new Map(pages.map((page) => [page.name, page]));
    const problems: string[] = [];
    for (const entry of exempt) {
      const page = byName.get(entry.page);
      if (!entry.reason || entry.reason.trim().length < 10) problems.push(`${entry.page}: the reason is empty`);
      if (!page) problems.push(`${entry.page}: no exported *Page has this name (remove the entry)`);
      else if (conforms(page)) problems.push(`${entry.page}: now conforms to the contract (remove the entry)`);
    }
    expect(problems).toEqual([]);
    expect(new Set(exempt.map((entry) => entry.page)).size).toBe(exempt.length);
  });
});

describe('the migrated operations pages (compile time)', () => {
  it('extend PageSlotsBase and accept every member of it', () => {
    type SlotsOf<P extends { slots?: unknown }> = NonNullable<P['slots']>;

    expectTypeOf<SlotsOf<JobsPageProps>>().toExtend<PageSlotsBase>();
    expectTypeOf<PageSlotsBase>().toExtend<SlotsOf<JobsPageProps>>();
    expectTypeOf<SlotsOf<JobInsightsPageProps>>().toExtend<PageSlotsBase>();
    expectTypeOf<PageSlotsBase>().toExtend<SlotsOf<JobInsightsPageProps>>();
    expectTypeOf<SlotsOf<WorkersPageProps>>().toExtend<PageSlotsBase>();
    expectTypeOf<PageSlotsBase>().toExtend<SlotsOf<WorkersPageProps>>();
    expectTypeOf<SlotsOf<DbBackupPageProps>>().toExtend<PageSlotsBase>();
    expectTypeOf<PageSlotsBase>().toExtend<SlotsOf<DbBackupPageProps>>();
    expectTypeOf<SlotsOf<DoctorPageProps>>().toExtend<PageSlotsBase>();
    expectTypeOf<PageSlotsBase>().toExtend<SlotsOf<DoctorPageProps>>();
    expectTypeOf<SlotsOf<TelemetryDashboardPageProps>>().toExtend<PageSlotsBase>();
    expectTypeOf<PageSlotsBase>().toExtend<SlotsOf<TelemetryDashboardPageProps>>();
    expectTypeOf<SlotsOf<TelemetryExplorerPageProps>>().toExtend<PageSlotsBase>();
    expectTypeOf<PageSlotsBase>().toExtend<SlotsOf<TelemetryExplorerPageProps>>();
    expectTypeOf<SlotsOf<TelemetrySettingsPageProps>>().toExtend<PageSlotsBase>();
    expectTypeOf<PageSlotsBase>().toExtend<SlotsOf<TelemetrySettingsPageProps>>();

    // The table pages also carry the table slots.
    expectTypeOf<SlotsOf<JobsPageProps>>().toExtend<Pick<TableSlots<unknown>, 'Toolbar'>>();
    expectTypeOf<SlotsOf<WorkersPageProps>>().toExtend<Pick<TableSlots<unknown>, 'Toolbar'>>();
    expect(true).toBe(true);
  });
});
