/**
 * The telemetry store cannot be queried right now (not configured, disabled,
 * unreachable, timed out). A kind throws it; the evaluator records it on the
 * rule (`lastError`) and leaves the rule's incidents untouched, so a store
 * outage never resolves, flaps or fires anything by itself.
 *
 * @stability experimental
 */
export class AlertStoreUnavailableError extends Error {
  /**
   * @param message - why the store could not be used.
   * @param cause - the underlying error, if any.
   */
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AlertStoreUnavailableError';
  }
}

/**
 * One schema issue of a refused config.
 *
 * @stability experimental
 */
export interface AlertConfigIssue {
  /** Dotted path of the offending value. */
  path: string;
  /** What is wrong with it. */
  message: string;
}

/**
 * A rule's config does not match its kind's schema (on write), or a kind id
 * nobody registered.
 *
 * @stability experimental
 */
export class AlertConfigError extends Error {
  /**
   * @param code - an `ALERT_ERROR_CODES` value.
   * @param message - what is wrong.
   * @param issues - the schema issues, when the config failed validation.
   */
  constructor(readonly code: string, message: string, readonly issues?: ReadonlyArray<AlertConfigIssue>) {
    super(message);
    this.name = 'AlertConfigError';
  }
}
