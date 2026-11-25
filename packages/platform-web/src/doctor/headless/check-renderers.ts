// =============================================================================
// The Doctor check renderer registry (PP-14.23)
// =============================================================================
//
// A Doctor check reports a status, a detail line, a remedy, an error and, when
// it has them, `data`: small scalar facts (counts, versions, latencies). The
// page prints the first four and leaves `data` out, because what a count means
// is the check's own business. An app (or a package that registers a check on
// the API) draws the facts of ITS check by registering a component here, keyed
// by the check's id:
//
//   registerDoctorCheckRenderer('example.capability', CapabilityFacts);
//
// The component is drawn INSIDE the check's row, after the remedy and the
// error and before the "Open settings" link. A check with no registered
// renderer renders exactly as it always did.
//
// The registry lives in the headless entry, not beside the page, so an app can
// register at module scope without importing the page (and MUI) into its main
// chunk; the page reads it at render time, so register before the page renders.
// A renderer is presentation only: it receives the report row (data, never an
// API client) and enforces nothing; the report is the API's.
// =============================================================================

import type { ComponentType } from 'react';
import type { DoctorCheckReport } from '@marinoscar/platform-contract/doctor';

/**
 * What a registered check renderer receives: the report row of its check.
 * `check.data` is `null` when the check reported no facts.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface DoctorCheckRendererProps {
  /** The check as the report returned it. */
  check: DoctorCheckReport;
}

/**
 * A component that draws one check's facts inside its row on the Doctor page.
 * It receives {@link DoctorCheckRendererProps}.
 *
 * @stability experimental
 */
export type DoctorCheckRenderer = ComponentType<DoctorCheckRendererProps>;

const renderers = new Map<string, DoctorCheckRenderer>();

/**
 * Registers the component that draws the check `checkId` inside its row on the
 * Doctor page (its `check.data`, a chart of its history, a link to its runbook).
 * A second registration for the same id replaces the first, so a hot module
 * reload that re-runs the registering module works. Call it at module scope,
 * before the page renders (the page reads the registry when it renders a row).
 *
 * Match is by the exact check id (`'storage.bucket'`). A check with no
 * renderer is drawn as it always was.
 *
 * @param checkId - the id of the check as the API reports it.
 * @param Component - the renderer; see {@link DoctorCheckRendererProps}.
 * @returns a function that removes this registration (it removes nothing if a
 *   later registration replaced it).
 *
 * @example
 * ```tsx
 * import { registerDoctorCheckRenderer } from '@marinoscar/platform-web/doctor/headless';
 *
 * registerDoctorCheckRenderer('example.capability', ({ check }) => (
 *   <p>{check.data?.configured ? 'Configured' : 'Not configured'}</p>
 * ));
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerDoctorCheckRenderer(checkId: string, Component: DoctorCheckRenderer): () => void {
  renderers.set(checkId, Component);
  return () => {
    if (renderers.get(checkId) === Component) renderers.delete(checkId);
  };
}

/**
 * The renderer registered for `checkId`, or `undefined` (the row is then drawn
 * as it always was).
 *
 * @param checkId - the id of the check.
 * @stability experimental
 */
export function getDoctorCheckRenderer(checkId: string): DoctorCheckRenderer | undefined {
  return renderers.get(checkId);
}
