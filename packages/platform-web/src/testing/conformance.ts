// =============================================================================
// The web conformance harness (issue #742)
// =============================================================================
//
// The counterpart of `runPlatformConformance` (`@marinoscar/platform-api/testing`)
// for the browser app. A suite is an invariant over what the app DECLARES (its
// settings registries, its route table, its destinations), discovered from that
// data and never hand-listed; the app calls `runPlatformWebConformance(...)` in
// one test file and passes the data. A slice that ships a suite registers it in
// `webConformanceSuites` when its `testing` entry is imported
// (`@marinoscar/platform-web/settings/testing`).
//
// This file imports no test runner and no Node module: it is handed a minimal
// test API (`describe`, `it`, `expect`), defaulting to the runner's globals, so
// it works under Vitest with `globals: true` and in a package test with a
// recording fake. Reading a file is the APP's job (it passes the text), which
// keeps the package free of Node types.
// =============================================================================

/**
 * The slice of a test runner the web harness needs.
 *
 * @stability experimental
 */
export interface WebConformanceTestApi {
  /** Registers a group of tests. */
  describe(name: string, fn: () => void): void;
  /** Registers one test. */
  it(name: string, fn: () => void | Promise<void>): void;
  /** The assertion entry point; only the matchers below are ever used. */
  expect: (actual: unknown) => {
    /** Deep equality with `expected`. */
    toEqual(expected: unknown): void;
    /** The actual array contains `item`. */
    toContain(item: unknown): void;
    /** The actual number is at least `n`. */
    toBeGreaterThanOrEqual(n: number): void;
  };
}

/**
 * One card of an app's settings registry, as the harness types it. Structural:
 * the app's `SettingsSectionDef[]` is assignable, and the settings suites read
 * it back as that type. (This slice cannot import the settings slice.)
 *
 * @stability experimental
 */
export interface WebConformanceCard {
  /** The card and page title. */
  title: string;
  /** The card's one or two sentences. */
  description: string;
  /** The icon component. */
  Icon: unknown;
  /** The route the card navigates to. */
  path?: string;
  /** Rendered but inert. */
  disabled?: boolean;
  /** The permission (or any-of list) required to see the card. */
  permission?: string | readonly string[];
  /** Show the card even when `permission` is not held. */
  alwaysShow?: boolean;
  /** The deployment feature the card exists under. */
  feature?: string;
}

/**
 * A titled group of cards, as the harness types it.
 *
 * @stability experimental
 */
export interface WebConformanceSection {
  /** The group's label. */
  label: string;
  /** Its cards, in order. */
  cards: WebConformanceCard[];
}

/**
 * One route the app declares, as the suites read it.
 *
 * @stability experimental
 */
export interface AppRouteDef {
  /** The route path (`/admin/settings/users`), exactly as declared. */
  path: string;
  /**
   * The permission gate of the route: a permission, the ANY-OF list of an
   * any-of guard, or `null` for a route with no permission gate (a redirect,
   * or a page open to every signed-in user).
   */
  permission?: string | readonly string[] | null;
}

/**
 * The app's destination table, as the route-ownership suite reads it. The app
 * passes its own functions (`config/destinations.ts`), so the suite checks the
 * table the app really runs.
 *
 * @stability experimental
 */
export interface WebDestinationsView {
  /** Route prefixes each destination owns, by destination key. */
  routes: Readonly<Record<string, readonly string[]>>;
  /** Routes deliberately owned by no destination (the login screen). */
  unowned: readonly string[];
  /** Whether `prefix` owns `path`, on segment boundaries. */
  owns(prefix: string, path: string): boolean;
  /** The destination key that is active at `pathname`, or `null`. */
  resolveActive(pathname: string): string | null;
  /** Every destination, with the path it navigates to. */
  destinations: readonly WebDestinationEntry[];
}

/**
 * A hub's route and title.
 *
 * @stability experimental
 */
export interface WebConformanceHub {
  /** The hub's route (`/admin/settings`). */
  path: string;
  /** The hub's title, which `settingsPageTitle` falls back to. */
  title: string;
}

/**
 * The admin and the per-user settings hub.
 *
 * @stability experimental
 */
export interface WebConformanceHubs {
  /** The admin hub (`/admin/settings`). */
  admin: WebConformanceHub;
  /** The per-user hub (`/settings`). */
  user: WebConformanceHub;
}

/**
 * One destination of the app's navigation.
 *
 * @stability experimental
 */
export interface WebDestinationEntry {
  /** The destination's key (`home`, `settings`, `console`). */
  key: string;
  /** The path it navigates to. */
  path: string;
}

/**
 * The text of the app's route file, which the suites parse for `<Route>` elements.
 *
 * @stability experimental
 */
export interface WebConformanceRouteSource {
  /** The source text of `App.tsx` (the app reads the file; this package has no Node types). */
  appTsx: string;
}

/**
 * The app's OpenAPI document, as far as the suites read it.
 *
 * @stability experimental
 */
export interface WebConformanceOpenApiDocument {
  /** Path items by path, each holding one operation per HTTP method. */
  paths?: Record<string, unknown>;
}

/**
 * An explicit, argued opt-out of one suite.
 *
 * @stability experimental
 */
export interface WebConformanceSkip {
  /** Why this app does not run the suite; required, and printed in the run summary. */
  skip: string;
}

/**
 * What the app hands the web suites: its registries and route table, and the
 * permission ids its API enforces.
 *
 * @stability experimental
 */
export interface WebConformanceContext {
  /** The admin settings registry (`ADMIN_SECTIONS`). */
  adminSections: WebConformanceSection[];
  /** The per-user settings registry (`USER_SETTINGS_SECTIONS`). */
  userSettingsSections: WebConformanceSection[];
  /** Each hub's route and title (`settingsPageTitle` falls back to the title). */
  hubs: WebConformanceHubs;
  /**
   * The route table, preferably as data. The fallback is the text of the app's
   * route file (`App.tsx`), parsed for `<Route path=... permission=...>`, so the
   * suite still reads the live routes and never a copy; the app reads the file.
   */
  routes: readonly AppRouteDef[] | WebConformanceRouteSource;
  /** Every permission id the API enforces (the generated permission catalog, `apps/api/prisma/catalog/permissions.json`). */
  apiPermissions: readonly string[];
  /**
   * The app's OpenAPI document, when the test environment has one (it is
   * generated by `npm run openapi:dump`). With it, a card's permission must also
   * be one a route of the surface it fronts declares in its `x-rbac` metadata.
   */
  openApiDocument?: WebConformanceOpenApiDocument;
  /** The destination table; required by `settings-route-ownership` and the console check of `settings-card-routes`. */
  destinations?: WebDestinationsView;
}

/**
 * A runnable web invariant. Register one in {@link webConformanceSuites}; the
 * harness registers a `describe` block for it unless the app skips it.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface WebConformanceSuite {
  /** Stable id, for example `'settings-registry-gates'`; the key of an app's `skip` entry. */
  readonly id: string;
  /** The `describe` title. */
  readonly title: string;
  /** One sentence: the invariant this enforces. */
  readonly description: string;
  /** Registers the suite's tests against the app's data. Throws only on misconfiguration. */
  register(api: WebConformanceTestApi, context: WebConformanceContext): void;
}

/**
 * What an app passes to {@link runPlatformWebConformance}.
 *
 * @example
 * ```ts
 * import '@marinoscar/platform-web/settings/testing'; // registers the settings suites
 * runPlatformWebConformance({
 *   adminSections: ADMIN_SECTIONS,
 *   userSettingsSections: USER_SETTINGS_SECTIONS,
 *   hubs: { admin: { path: ADMIN_HUB_PATH, title: ADMIN_HUB_TITLE }, user: { path: USER_HUB_PATH, title: USER_HUB_TITLE } },
 *   routes: { appTsx: readFileSync(APP_TSX, 'utf8') },
 *   apiPermissions: catalog.permissions.map((p) => p.name),
 *   suites: { 'settings-route-ownership': { skip: 'This app has no destination table.' } },
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface PlatformWebConformanceOptions extends WebConformanceContext {
  /** Explicit opt-outs, by suite id; every entry needs a reason, which is printed in the run summary. */
  suites?: Readonly<Record<string, WebConformanceSkip>>;
  /** Defaults to the globals `describe`/`it`/`expect` (Vitest with `globals: true`, or Jest). */
  testApi?: WebConformanceTestApi;
  /** Where the summary table of suites run and skipped goes. Default: the console, unless `testApi` is injected (then nothing is printed). */
  summaryOutput?: (table: string) => void;
}

/**
 * Every web conformance suite the harness can run, by id. Filled when a
 * slice's `testing` entry is imported; frozen on the first run, so a late
 * registration fails loudly.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const webConformanceSuites = {
  /** @internal */ entries: new Map<string, WebConformanceSuite>(),
  /** @internal */ frozen: false,
  /**
   * Adds a suite; a second registration of the same id is ignored (importing a
   * `testing` entry twice is harmless).
   *
   * @param suite - the suite.
   * @throws Error once the harness has run: a suite registered after the first run would never run.
   */
  register(suite: WebConformanceSuite): void {
    if (this.entries.has(suite.id)) return;
    if (this.frozen) {
      throw new Error(`webConformanceSuites: "${suite.id}" registered after runPlatformWebConformance ran; import the testing entry first.`);
    }
    this.entries.set(suite.id, suite);
  },
  /** The registered suites, in registration order. */
  list(): WebConformanceSuite[] {
    return [...this.entries.values()];
  },
  /** The registered suite ids, in registration order. */
  ids(): string[] {
    return [...this.entries.keys()];
  },
};

/** The runner's own globals, or a clear error when there are none. */
function globalTestApi(): WebConformanceTestApi {
  const g = globalThis as unknown as Partial<WebConformanceTestApi>;
  if (typeof g.describe !== 'function' || typeof g.it !== 'function' || typeof g.expect !== 'function') {
    throw new Error(
      'runPlatformWebConformance: no global describe/it/expect. Run it under Vitest with `globals: true`, or pass `testApi`.',
    );
  }
  return { describe: g.describe, it: g.it, expect: g.expect };
}

/**
 * One row of the run summary.
 *
 * @stability experimental
 */
export interface WebConformanceSummaryEntry {
  /** The suite id. */
  id: string;
  /** `run`, or `skipped` when the app opted out with a reason. */
  status: 'run' | 'skipped';
  /** The app's reason, for a skipped suite. */
  reason?: string;
}

/**
 * The summary table `runPlatformWebConformance` prints.
 *
 * @param entries - one per registered suite.
 * @returns a plain-text table, one line per suite under a header.
 *
 * @stability experimental
 */
export function formatWebConformanceSummary(entries: readonly WebConformanceSummaryEntry[]): string {
  const width = Math.max('suite'.length, ...entries.map((entry) => entry.id.length));
  const lines = entries.map(
    (entry) => `${entry.id.padEnd(width)}  ${entry.status === 'run' ? 'run' : `skipped: ${entry.reason ?? ''}`}`,
  );
  const ran = entries.filter((entry) => entry.status === 'run').length;
  return [`${'suite'.padEnd(width)}  status`, ...lines, `${ran} run, ${entries.length - ran} skipped`].join('\n');
}

/**
 * Registers one `describe` block per registered web conformance suite, over
 * the app's own registries and route table. Call it at the top level of a test
 * file.
 *
 * @param options - see {@link PlatformWebConformanceOptions}.
 * @throws Error when `suites` names a suite that is not registered (a typo must not disable a check), when a skip has no reason, when no suite is registered (the testing entry was not imported), or when no test API is available.
 *
 * @extensionPoint option
 * @stability experimental
 */
export function runPlatformWebConformance(options: PlatformWebConformanceOptions): void {
  webConformanceSuites.frozen = true;

  const known = new Set(webConformanceSuites.ids());
  const skips = options.suites ?? {};

  for (const [id, entry] of Object.entries(skips)) {
    if (!known.has(id)) {
      throw new Error(
        `runPlatformWebConformance: unknown conformance suite "${id}". Known suites: ${[...known].join(', ') || '(none)'}. ` +
          "A suite that ships with a slice registers when the slice's testing entry is imported ('@marinoscar/platform-web/settings/testing').",
      );
    }
    if (typeof entry?.skip !== 'string' || entry.skip.trim() === '') {
      throw new Error(`runPlatformWebConformance: suite "${id}" is skipped without a reason. Pass \`'${id}': { skip: 'why this app does not run it' }\`.`);
    }
  }
  if (known.size === 0) {
    throw new Error("runPlatformWebConformance: no suite is registered. Import a slice's testing entry first ('@marinoscar/platform-web/settings/testing').");
  }

  const api = options.testApi ?? globalTestApi();
  const summary: WebConformanceSummaryEntry[] = [];

  for (const suite of webConformanceSuites.list()) {
    const skip = skips[suite.id];
    if (skip) {
      const reason = skip.skip.trim();
      summary.push({ id: suite.id, status: 'skipped', reason });
      api.describe(suite.title, () => {
        api.it(`${suite.id}: skipped by the app (${reason})`, () => undefined);
      });
      continue;
    }
    summary.push({ id: suite.id, status: 'run' });
    suite.register(api, options);
  }

  // The summary is printed at registration time, not registered as a test: a
  // test would change the case list of the suites the app runs. A test API the
  // caller injects (a recording fake) prints nothing unless `summaryOutput` says where.
  const table = formatWebConformanceSummary(summary);
  if (options.summaryOutput) options.summaryOutput(table);
  else if (options.testApi === undefined) {
    // `console` is not in this package's types (a browser package); the harness
    // only ever runs in a test runner, where it is.
    (globalThis as unknown as { console: { info(message: string): void } }).console.info(`\n${table}`);
  }
}
