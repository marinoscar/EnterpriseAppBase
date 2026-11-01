import { registerNodeVital, type NodeVitalDef } from '@marinoscar/platform-web/nodes/headless';

// =============================================================================
// EXAMPLE, NOT WIRED: how the fleet page words an executor's app vitals (PP-14.19)
// =============================================================================
//
// The browser half of `apps/cli/src/examples/transcode.executor.ts`: that
// executor reports `transcode.active` and `transcode.frames` on every heartbeat
// as `vitals.extra`, the API stores them, and the Worker Nodes page's vitals
// dialog prints them. Without a registration a key still shows, by its key as a
// plain number; `registerNodeVital` gives it a label an operator can read and a
// unit (`count`, `percent`, `bytes`, `milliseconds`, `seconds`, or any text
// shown after the number).
//
// Call `registerTranscodeVitals()` once, at module scope (for example from
// `platform/nodesAdapters.ts`), before the page renders. Proved by
// __tests__/examples/nodes/transcode-vitals.test.tsx.
// =============================================================================

/** The transcode executor's vitals, as an operator reads them. */
export const TRANSCODE_VITALS: readonly NodeVitalDef[] = [
  { key: 'transcode.active', label: 'Transcodes running', unit: 'count' },
  { key: 'transcode.frames', label: 'Frames transcoded', unit: 'count' },
];

/** Registers {@link TRANSCODE_VITALS} with the vitals dialog. */
export function registerTranscodeVitals(): void {
  for (const vital of TRANSCODE_VITALS) registerNodeVital(vital);
}
