// =============================================================================
// Labels of the capabilities an app registered (PP-14.17, issue #935)
// =============================================================================
//
// The capability vocabulary is open: an app adds `speaker_diarization` with
// `registerAiCapability` on the API, and a model can then declare it. The web
// draws a capability as its LABEL (chips, filters, the override dialog), and
// must not need a code change to do it, so the labels come from two places:
//
//   - the API: `GET /api/admin/ai/capabilities`, which the admin pages fetch
//     (`useAiCapabilities`) and record here;
//   - the app: `registerAiCapabilityLabel('speaker_diarization', 'Diarization')`
//     at module scope, for a page a viewer without `ai_config:read` sees (the
//     Playground and the user pages cannot read the admin route).
//
// A capability with neither renders as its id: it never vanishes. The built-in
// fourteen are labelled in `ui/shared/aiCapabilities.ts` and never overridden here.
// =============================================================================

const labels = new Map<string, string>();

/**
 * Teaches the pages the label of one capability an app registered
 * (`registerAiCapability` on the API). Call it at module scope, before the
 * pages render. A later call for the same id replaces the label.
 *
 * @param id - the capability id (`speaker_diarization`).
 * @param label - the short label the pages show (`Diarization`).
 *
 * @example
 * ```ts
 * registerAiCapabilityLabel('speaker_diarization', 'Diarization');
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAiCapabilityLabel(id: string, label: string): void {
  if (id && label) labels.set(id, label);
}

/**
 * Records the labels the API reported (what `useAiCapabilities` does after a fetch).
 *
 * @param descriptors - `GET /admin/ai/capabilities`'s `capabilities`.
 *
 * @stability experimental
 */
export function registerAiCapabilityLabels(descriptors: ReadonlyArray<{ id: string; label: string }>): void {
  for (const descriptor of descriptors) registerAiCapabilityLabel(descriptor.id, descriptor.label);
}

/**
 * The label registered for `id`, or `undefined`.
 *
 * @param id - the capability id.
 *
 * @stability experimental
 */
export function getRegisteredAiCapabilityLabel(id: string): string | undefined {
  return labels.get(id);
}

/**
 * Forgets every registered label (tests only).
 *
 * @internal
 */
export function resetAiCapabilityLabelsForTests(): void {
  labels.clear();
}
