import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ConformanceTestApi } from '../conformance.js';
import type { DashboardReducer } from './dashboard/source.js';
import {
  listTuiMenuNodes,
  TUI_MENU_MAX_DEPTH,
  TUI_MENU_ROOT,
  validateTuiMenuNodes,
  type TuiMenuNode,
} from './menu-registry.js';
import { buildTuiMenuTree, tuiRouteRequiresLogin, visibleTuiMenuChildren, type TuiMenuTree } from './menu-tree.js';
import { BUILTIN_TUI_SCREENS, listRegisteredTuiScreens, type TuiScreenRegistration } from './screen-registry.js';
import { listTuiScreenSections, TUI_SECTION_SCREENS } from './section-registry.js';
import type { TuiTheme } from './theme.js';

// =============================================================================
// The `tui` conformance suite  (RETRO-G1.5, #1069)
// =============================================================================
//
// An executable contract over an app's TUI registrations, run by
// `runPlatformConformance({ suites: { tui: {} } })` after `createCli`:
//
//   menu-references    every entry opens a registered screen, every section is
//                      reachable, no cycles, nesting <= TUI_MENU_MAX_DEPTH;
//   lazy-screens       every app screen and screen section uses `load`, so
//                      `--help` and `api` never load ink (opt out per route);
//   no-ink-import      importing `@marinoscar/platform-cli/tui` (and the app's
//                      own registration module) loads no `ink`, proven in a
//                      fresh Node process with a resolve hook;
//   labels             every label is non-empty for logged-in AND logged-out;
//   reducer-purity     each dashboard reducer leaves a frozen input untouched;
//   screens-render     every app screen renders (a non-empty frame, no crash) at
//                      80 / 40 / 24 columns;
//   no-color           ... and under the monochrome theme emits no colour code;
//   login-gate         every login-gated entry shows the "not logged in" notice
//                      when logged out.
//
// Each check is skippable with a written reason (`skip: { 'no-color': 'why' }`),
// like a suite is. The pure checks are exported (`checkTuiMenu`, ...) so a
// test can prove each one fails on a broken fixture.
//
// The three render checks use the TUI testing kit (`/tui/testing`), which needs
// `ink-testing-library`; it is imported inside those cases only, so the pure
// checks run without it.
// =============================================================================

/**
 * The checks of the `tui` suite.
 *
 * @stability experimental
 */
export const TUI_CONFORMANCE_CHECKS = [
  'menu-references',
  'lazy-screens',
  'no-ink-import',
  'labels',
  'reducer-purity',
  'screens-render',
  'no-color',
  'login-gate',
] as const;

/**
 * One check of the `tui` suite.
 *
 * @stability experimental
 */
export type TuiConformanceCheck = (typeof TUI_CONFORMANCE_CHECKS)[number];

/**
 * A dashboard reducer to check for purity.
 *
 * @stability experimental
 */
export interface TuiDashboardCheck {
  /** Shown in the case name. */
  id: string;
  /** The reducer (any state and event types). */
  reducer: DashboardReducer<any, any>;
  /** Sample events to fold into the frozen initial state. */
  events?: readonly unknown[] | undefined;
  /** A sample snapshot for `hydrate`. */
  snapshot?: unknown;
}

/**
 * Options of the `tui` suite. Every field is optional: with none, the suite
 * checks the registrations `createCli` collected.
 *
 * @stability experimental
 */
export interface TuiConformanceOptions {
  /** Routes allowed to use `component` instead of `load` (each should be a deliberate choice). */
  allowEager?: readonly string[] | undefined;
  /**
   * What the no-ink check imports, in a fresh process: module specifiers
   * (resolved from the working directory), absolute paths or `file:` URLs.
   * Default `['@marinoscar/platform-cli/tui']`. Add the app's compiled
   * registration module (`dist/app.js`); a `.ts` file cannot be loaded.
   */
  importEntries?: readonly string[] | undefined;
  /** Dashboard reducers to check. */
  dashboards?: readonly TuiDashboardCheck[] | undefined;
  /** `params` to give an app screen by route when it is rendered. */
  screenParams?: Readonly<Record<string, unknown>> | undefined;
  /** Terminal widths of the render checks. Default `[80, 40, 24]`. */
  columns?: readonly number[] | undefined;
  /** Skip a check, with the reason (required, and printed in the case name). */
  skip?: Partial<Record<TuiConformanceCheck, string>> | undefined;
  /** Replaces the registered menu nodes (a test seam). */
  nodes?: readonly TuiMenuNode[] | undefined;
  /** Replaces the registered app screens (a test seam). */
  screens?: readonly TuiScreenRegistration[] | undefined;
}

// -----------------------------------------------------------------------------
// The pure checks
// -----------------------------------------------------------------------------

function builtinScreenInfos() {
  return BUILTIN_TUI_SCREENS.map(({ route, order }) => ({ route, order, label: route }));
}

/** The tree the suite checks: the built-ins with their route as label, then the app's screens. */
function treeOf(nodes: readonly TuiMenuNode[], screens: readonly TuiScreenRegistration[]): TuiMenuTree {
  return buildTuiMenuTree(nodes, [...builtinScreenInfos(), ...screens]);
}

/**
 * Checks the menu: references, reachability, cycles and depth.
 *
 * @param nodes - The menu nodes.
 * @param screens - The app screens (the built-in routes are added).
 * @returns One message per problem; empty when the menu is sound.
 * @stability experimental
 */
export function checkTuiMenu(nodes: readonly TuiMenuNode[], screens: readonly TuiScreenRegistration[]): string[] {
  const routes = [...BUILTIN_TUI_SCREENS, ...screens].map((screen) => screen.route);
  const problems: string[] = [];
  // `validateTuiMenuNodes` stops at the first problem; check node by node so a
  // report names every one.
  for (const node of nodes) {
    try {
      validateTuiMenuNodes(nodes.filter((other) => other === node || isAncestor(nodes, other, node)), routes);
    } catch (error) {
      const message = (error as Error).message;
      if (!problems.includes(message)) problems.push(message);
    }
  }
  if (problems.length > 0) return problems;
  const tree = treeOf(nodes, screens);
  const reached = new Set<string>();
  const walk = (sectionId: string, loggedIn: boolean): void => {
    if (reached.has(`${sectionId}:${loggedIn}`)) return;
    reached.add(`${sectionId}:${loggedIn}`);
    for (const child of visibleTuiMenuChildren(sectionId, { loggedIn }, tree)) {
      if (child.kind === 'section') walk(child.id, loggedIn);
    }
  };
  walk(TUI_MENU_ROOT, true);
  walk(TUI_MENU_ROOT, false);
  for (const id of tree.sections.keys()) {
    if (id === TUI_MENU_ROOT) continue;
    if (!reached.has(`${id}:true`) && !reached.has(`${id}:false`)) {
      problems.push(`TUI menu section "${id}" is unreachable: it has no entry visible to a logged-in or a logged-out user.`);
    }
  }
  return problems;
}

/** True when `candidate` is on the parent chain of `node` (so validating them together sees the node's depth and cycles). */
function isAncestor(nodes: readonly TuiMenuNode[], candidate: TuiMenuNode, node: TuiMenuNode): boolean {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  let parent = node.parent;
  while (parent !== undefined && parent !== TUI_MENU_ROOT && !seen.has(parent)) {
    if (parent === candidate.id) return true;
    seen.add(parent);
    parent = byId.get(parent)?.parent;
  }
  return false;
}

/**
 * Checks that every app screen and screen section loads lazily.
 *
 * @param screens - The app screens.
 * @param allowEager - Routes allowed to use `component`.
 * @returns One message per eager registration.
 * @stability experimental
 */
export function checkTuiLazy(
  screens: readonly TuiScreenRegistration[],
  allowEager: readonly string[] = [],
  sections: ReadonlyArray<{ screen: string; id: string; component?: unknown; load?: unknown }> = TUI_SECTION_SCREENS.flatMap((screen) =>
    listTuiScreenSections(screen),
  ),
): string[] {
  const problems: string[] = [];
  for (const screen of screens) {
    if (screen.component !== undefined && !allowEager.includes(screen.route)) {
      problems.push(
        `TUI screen "${screen.route}" is registered with \`component\`, which loads ink on every run (\`--help\` and \`api\` included). Use \`load: async () => (await import('./x.js')).X\`, or list the route in \`allowEager\` for a reason.`,
      );
    }
  }
  for (const section of sections) {
    if (section.component !== undefined && !allowEager.includes(`${section.screen}:${section.id}`)) {
      problems.push(
        `TUI section "${section.screen}:${section.id}" is registered with \`component\`; use \`{ id, load }\`, or list "${section.screen}:${section.id}" in \`allowEager\`.`,
      );
    }
  }
  return problems;
}

/**
 * Checks that every label is non-empty for both login states.
 *
 * @param nodes - The menu nodes.
 * @param screens - The app screens.
 * @returns One message per bad label.
 * @stability experimental
 */
export function checkTuiLabels(nodes: readonly TuiMenuNode[], screens: readonly TuiScreenRegistration[]): string[] {
  const problems: string[] = [];
  const check = (what: string, label: unknown): void => {
    for (const loggedIn of [true, false]) {
      const state = loggedIn ? 'logged in' : 'logged out';
      try {
        const text = typeof label === 'function' ? (label as (context: { loggedIn: boolean }) => unknown)({ loggedIn }) : label;
        if (typeof text !== 'string' || text.trim() === '') {
          problems.push(`${what} has an empty label when ${state}.`);
        }
      } catch (error) {
        problems.push(`${what}'s label function throws when ${state}: ${(error as Error).message}`);
      }
    }
  };
  for (const node of nodes) check(`TUI menu ${node.kind} "${node.id}"`, node.label);
  for (const screen of screens) check(`TUI screen "${screen.route}"`, screen.label);
  return problems;
}

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  return value;
}

function plain(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? `${item}n` : item));
}

/**
 * Checks that a dashboard reducer is pure: folding events into a deeply frozen
 * `initial()` neither throws a mutation error nor changes it, and `initial()`
 * returns a fresh value each call.
 *
 * @param dashboard - The reducer with sample events.
 * @returns One message per problem.
 * @stability experimental
 */
export function checkDashboardReducer(dashboard: TuiDashboardCheck): string[] {
  const problems: string[] = [];
  const reducer = dashboard.reducer as unknown as DashboardReducer<unknown, unknown>;
  const name = `Dashboard reducer "${dashboard.id}"`;
  const first = reducer.initial();
  if (typeof first === 'object' && first !== null && first === reducer.initial()) {
    problems.push(`${name}: initial() returns the same object every call; a reducer that mutates it would leak state between dashboards.`);
  }
  const frozen = deepFreeze(reducer.initial());
  const before = plain(frozen);
  const attempt = (step: string, run: () => unknown): void => {
    try {
      run();
    } catch (error) {
      problems.push(`${name}: ${step} threw on a frozen input (it mutates its input, or fails): ${(error as Error).message}`);
    }
    if (plain(frozen) !== before) problems.push(`${name}: ${step} changed initial().`);
  };
  if (dashboard.snapshot !== undefined) attempt('hydrate(initial(), snapshot)', () => reducer.hydrate(frozen, dashboard.snapshot));
  for (const [index, event] of (dashboard.events ?? []).entries()) {
    attempt(`reduce(initial(), events[${index}])`, () => reducer.reduce(frozen, event));
  }
  if (reducer.log !== undefined) attempt('log(initial(), [])', () => reducer.log?.(frozen, []));
  return problems;
}

const HOOK_SOURCE = `
let port;
export function initialize(data) { port = data.port; }
export async function resolve(specifier, context, next) {
  if (/^ink(\\/|$)/.test(specifier) || specifier === 'ink-testing-library') port.postMessage(specifier);
  return next(specifier, context);
}
`;

const CHILD_SOURCE = `
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
const { port1, port2 } = new MessageChannel();
const seen = new Set();
port1.on('message', (specifier) => seen.add(specifier));
register('data:text/javascript,' + encodeURIComponent(process.env.TUI_CONFORMANCE_HOOK), { parentURL: import.meta.url, data: { port: port2 }, transferList: [port2] });
const failures = [];
for (const entry of JSON.parse(process.env.TUI_CONFORMANCE_ENTRIES)) {
  try { await import(entry); } catch (error) { failures.push(entry + ': ' + (error && error.message || error)); }
}
await new Promise((resolve) => setTimeout(resolve, 100));
process.stdout.write(JSON.stringify({ ink: [...seen], failures }));
process.exit(0);
`;

function resolveEntry(entry: string): string {
  if (entry.startsWith('file:')) return entry;
  if (isAbsolute(entry)) return pathToFileURL(entry).href;
  return pathToFileURL(createRequire(`${process.cwd()}/`).resolve(entry)).href;
}

/**
 * Imports the entries in a fresh Node process and reports whether any of them
 * (or anything they import) resolved `ink`.
 *
 * @param entries - Specifiers, absolute paths or `file:` URLs. Default the `/tui` subpath.
 * @returns One message per problem; empty when nothing loaded ink.
 * @stability experimental
 */
export async function checkTuiNoInkImport(entries: readonly string[] = ['@marinoscar/platform-cli/tui']): Promise<string[]> {
  let urls: string[];
  try {
    urls = entries.map(resolveEntry);
  } catch (error) {
    return [`Cannot resolve a no-ink entry: ${(error as Error).message}`];
  }
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ['--input-type=module', '-e', CHILD_SOURCE],
      { env: { ...process.env, TUI_CONFORMANCE_HOOK: HOOK_SOURCE, TUI_CONFORMANCE_ENTRIES: JSON.stringify(urls) }, timeout: 60_000 },
      (error, stdout, stderr) => (error === null ? resolve(stdout) : reject(new Error(`${error.message}\n${stderr}`))),
    );
  });
  const report = JSON.parse(output) as { ink: string[]; failures: string[] };
  return [
    ...report.failures.map((failure) => `Could not import ${failure}`),
    ...(report.ink.length > 0
      ? [
          `Importing ${entries.join(', ')} loads ${[...new Set(report.ink)].join(', ')}. Registration modules must not import ink at the top level: register screens with \`load\` and import ink only inside the screen component's module.`,
        ]
      : []),
  ];
}

// -----------------------------------------------------------------------------
// The render checks
// -----------------------------------------------------------------------------

interface RenderKit {
  renderTuiScreen: typeof import('./testing/harness.js').renderTuiScreen;
  renderTuiRoute: typeof import('./testing/harness.js').renderTuiRoute;
  stripAnsi: typeof import('./testing/harness.js').stripAnsi;
  hasAnsi: typeof import('./testing/harness.js').hasAnsi;
}

async function loadRenderKit(): Promise<RenderKit> {
  try {
    return await import('./testing/harness.js');
  } catch (error) {
    throw new Error(
      `The tui render checks need ink-testing-library: install it as a dev dependency (\`npm i -D ink-testing-library\`), or skip them with a reason (\`skip: { 'screens-render': '...' }\`). ${(error as Error).message}`,
    );
  }
}

async function screenComponent(screen: TuiScreenRegistration) {
  return screen.component ?? (await screen.load?.());
}

/**
 * Renders an app screen at a width and reports a crash or an empty frame
 * (and, under `'mono'`, any colour escape).
 *
 * @param screen - The registration.
 * @param columns - The terminal width.
 * @param theme - `'mono'` for the colourless theme.
 * @param params - The screen's params.
 * @returns One message per problem.
 * @stability experimental
 */
export async function checkTuiScreenRender(
  screen: TuiScreenRegistration,
  columns: number,
  theme: TuiTheme | 'mono' | undefined,
  params: unknown,
): Promise<string[]> {
  const kit = await loadRenderKit();
  const problems: string[] = [];
  const name = `TUI screen "${screen.route}" at ${columns} columns${theme === 'mono' ? ' (monochrome)' : ''}`;
  try {
    const Screen = await screenComponent(screen);
    if (Screen === undefined) return [`${name}: has neither component nor load.`];
    const handle = await kit.renderTuiScreen(Screen, { columns, theme, params });
    try {
      const crashed = handle.crashed();
      if (crashed !== undefined) return [`${name}: crashed: ${crashed}`];
      const frame = handle.lastFrame() ?? '';
      const text = kit.stripAnsi(frame);
      if (text.trim() === '') problems.push(`${name}: rendered an empty frame.`);
      if (theme === 'mono' && kit.hasAnsi(frame)) problems.push(`${name}: emitted a colour escape under the monochrome theme (draw colour from \`useTuiTheme()\`).`);
    } finally {
      handle.unmount();
    }
  } catch (error) {
    problems.push(`${name}: crashed: ${(error as Error).message}`);
  }
  return problems;
}

/**
 * Opens a login-gated route while logged out and reports whether the notice shows.
 *
 * @param route - A registered route that an entry gates.
 * @returns One message per problem.
 * @stability experimental
 */
export async function checkTuiLoginGate(route: string): Promise<string[]> {
  const kit = await loadRenderKit();
  const handle = await kit.renderTuiRoute(route, { session: { loggedIn: false }, theme: 'mono' });
  try {
    const text = kit.stripAnsi(handle.lastFrame() ?? '');
    return /not logged in/i.test(text)
      ? []
      : [`TUI route "${route}" requires a login but showed no "not logged in" notice when logged out. The frame was:\n${text}`];
  } catch (error) {
    return [`TUI route "${route}" crashed when opened logged out: ${(error as Error).message}`];
  } finally {
    handle.unmount();
  }
}

// -----------------------------------------------------------------------------
// Registering the cases
// -----------------------------------------------------------------------------

/**
 * Registers the `tui` suite's cases.
 *
 * @param api - The test API.
 * @param options - The suite's options.
 * @stability experimental
 */
export function registerTuiConformance(api: ConformanceTestApi, options: TuiConformanceOptions): void {
  for (const [check, reason] of Object.entries(options.skip ?? {})) {
    if (!(TUI_CONFORMANCE_CHECKS as readonly string[]).includes(check)) {
      throw new Error(`tui conformance: unknown check "${check}" in \`skip\`. Known checks: ${TUI_CONFORMANCE_CHECKS.join(', ')}.`);
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`tui conformance: check "${check}" is skipped without a reason. Pass \`skip: { '${check}': 'why this app does not run it' }\`.`);
    }
  }
  const nodes = (): readonly TuiMenuNode[] => options.nodes ?? listTuiMenuNodes();
  const screens = (): readonly TuiScreenRegistration[] => options.screens ?? listRegisteredTuiScreens();
  // Throw the messages themselves: a matcher's diff would print `Array(1)`.
  const expectNone = (problems: string[]): void => {
    if (problems.length > 0) throw new Error(`\n${problems.join('\n')}`);
  };

  // A skipped check is one passing case that says why, as the suites do.
  const run = (check: TuiConformanceCheck, title: string, body: () => unknown): void => {
    const reason = options.skip?.[check];
    if (reason !== undefined) api.it(`${check}: skipped by the app (${reason})`, () => undefined);
    else api.it(`${check}: ${title}`, body);
  };

  api.describe('tui conformance', () => {
    run('menu-references', 'every entry opens a registered screen, every section is reachable, no cycles, depth within the cap', () =>
      expectNone(checkTuiMenu(nodes(), screens())),
    );
    run('lazy-screens', 'every app screen and section loads lazily', () => expectNone(checkTuiLazy(screens(), options.allowEager)));
    run('no-ink-import', 'importing the TUI entries loads no ink', async () =>
      expectNone(await checkTuiNoInkImport(options.importEntries)),
    );
    run('labels', 'every label is non-empty logged in and logged out', () => expectNone(checkTuiLabels(nodes(), screens())));
    for (const dashboard of options.dashboards ?? []) {
      run('reducer-purity', `dashboard "${dashboard.id}" does not mutate its input`, () => expectNone(checkDashboardReducer(dashboard)));
    }
    if (options.dashboards === undefined || options.dashboards.length === 0) {
      run('reducer-purity', 'no dashboard reducer was passed (nothing to check)', () => undefined);
    }
    const widths = options.columns ?? [80, 40, 24];
    for (const screen of screens()) {
      for (const columns of widths) {
        run('screens-render', `screen "${screen.route}" renders at ${columns} columns`, async () =>
          expectNone(await checkTuiScreenRender(screen, columns, undefined, options.screenParams?.[screen.route])),
        );
      }
      run('no-color', `screen "${screen.route}" draws no colour under the monochrome theme`, async () =>
        expectNone(await checkTuiScreenRender(screen, 80, 'mono', options.screenParams?.[screen.route])),
      );
    }
    run('login-gate', 'every login-gated entry shows the notice when logged out', async () => {
      const tree = treeOf(nodes(), screens());
      const gated = [...new Set(tree.entries.map((entry) => entry.route))].filter((route) => tuiRouteRequiresLogin(route, tree));
      const problems: string[] = [];
      for (const route of gated) problems.push(...(await checkTuiLoginGate(route)));
      expectNone(problems);
    });
  });
}

/** Re-exported so the conformance doc can state the cap. */
export { TUI_MENU_MAX_DEPTH };
