// =============================================================================
// Job type labels: a registry, not a closed map (issue #734)
// =============================================================================
//
// The admin job list, the insights page and the node fleet's job types show a
// short human phrase next to each dotted `Job.type` ("Fleet sweep" for
// `nodes.fleet.sweep`). Until #734 those phrases lived in one closed map,
// `JOB_TYPE_LABELS`, that every fork edited to label its own types. Now the
// label belongs to the type's owner:
//
//   1. A handler declares it: `readonly label = 'Fleet sweep'`.
//      `JobHandlerRegistry.register` records it with the handler.
//   2. A type whose handler is NOT loaded in this process (rows written by a
//      deployment's other replicas, a handler only some deployments register,
//      a type retired with history kept) registers one directly:
//      `registerJobTypeLabel('legacy.export', 'Legacy export')`.
//
// `jobTypeLabel(type)` resolves the handler's label, then the registered one,
// then falls back to the type string itself. Total by construction: every
// string in, a non-empty string out, so no caller writes its own `?? type`.
// An unlabelled type is a supported, expected state, never an error.
//
// Process-wide, like the other platform registries: a label is display data,
// identical for every module that asks.
// =============================================================================

const handlerLabels = new Map<string, string>();
const registeredLabels = new Map<string, string>();

function checked(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${what} must be a non-empty string, got ${JSON.stringify(value)}.`);
  }
  return value;
}

/**
 * Registers the display label of a job type whose handler may not be loaded
 * in this process. A handler's own `label` takes precedence. Registering the
 * same type again replaces the label (the last registration wins, like the
 * handler registry).
 *
 * @param type - the `Job.type` value.
 * @param label - a short phrase in sentence case, sized for a table cell.
 * @throws Error when either argument is empty.
 *
 * @example
 * ```ts
 * registerJobTypeLabel('legacy.export', 'Legacy export');
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerJobTypeLabel(type: string, label: string): void {
  registeredLabels.set(checked(type, 'registerJobTypeLabel: type'), checked(label, 'registerJobTypeLabel: label'));
}

/**
 * Records (or clears) the label a registered handler declared. Called by
 * `JobHandlerRegistry.register`; not for app code.
 *
 * @param type - the handler's type.
 * @param label - its `label`, or `undefined` when it declares none.
 *
 * @internal
 */
export function recordHandlerLabel(type: string, label: string | undefined): void {
  if (typeof label === 'string' && label.trim().length > 0) handlerLabels.set(type, label);
  else handlerLabels.delete(type);
}

/**
 * The display label for `type`: the registered handler's `label`, else a label
 * registered with {@link registerJobTypeLabel}, else `type` itself.
 *
 * @param type - the `Job.type` value.
 * @returns a non-empty label for a non-empty type.
 *
 * @stability stable
 */
export function jobTypeLabel(type: string): string {
  return handlerLabels.get(type) ?? registeredLabels.get(type) ?? type;
}

/**
 * Every label known now, by type, handler labels over registered ones: for a
 * snapshot test or a docs generator.
 *
 * @returns a fresh map.
 *
 * @stability experimental
 */
export function jobTypeLabels(): ReadonlyMap<string, string> {
  return new Map([...registeredLabels, ...handlerLabels]);
}
