// =============================================================================
// The `export.ready` and `export.failed` notifications (issue #744)
// =============================================================================
//
// Declared here as data, like the sharing slice's events: the app registers
// each with its notification registry (the reference app:
// `apps/api/src/platform/exports/exports.notifications.ts`), on the `browser`
// and `push` channels, on by default and not mandatory. Sent to the user who
// asked for the export, after the job's write committed. The browser renderer
// below also serves push. No URL in the data: the link opens the export page,
// which mints a fresh signed download.
// =============================================================================

import type { ExportNotificationData } from './ports';

/**
 * The page a notification links to (root-relative): the user settings card
 * "Download your data".
 *
 * @stability experimental
 */
export const DATA_EXPORT_PAGE_PATH = '/settings/data-export';

/**
 * A notification event, in the shape the reference app's registry takes.
 *
 * @stability experimental
 */
export interface ExportNotificationEventDef {
  /** The event key. Persisted in preferences and delivery rows: never rename it. */
  readonly key: string;
  /** Shown in the preferences matrix. */
  readonly label: string;
  /** Shown in the preferences matrix. */
  readonly description: string;
  /** The in-app bell and Web Push. */
  readonly channels: readonly ['browser', 'push'];
  /** On unless the user turns it off. */
  readonly defaultEnabled: true;
}

/**
 * `export.ready`: an export file is ready to download.
 *
 * @example
 * ```ts
 * { event: { ...EXPORT_READY_EVENT, channels: [...EXPORT_READY_EVENT.channels] }, browserTemplate: exportReadyBrowserTemplate }
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const EXPORT_READY_EVENT: ExportNotificationEventDef = Object.freeze({
  key: 'export.ready',
  label: 'Export ready',
  description: 'Sent when a data export you asked for is ready to download.',
  channels: ['browser', 'push'] as const,
  defaultEnabled: true as const,
});

/**
 * `export.failed`: an export could not be produced after its last attempt.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const EXPORT_FAILED_EVENT: ExportNotificationEventDef = Object.freeze({
  key: 'export.failed',
  label: 'Export failed',
  description: 'Sent when a data export you asked for could not be created.',
  channels: ['browser', 'push'] as const,
  defaultEnabled: true as const,
});

/**
 * The bell row and toast of an export notification.
 *
 * @stability experimental
 */
export interface ExportBrowserContent {
  /** One short line. */
  title: string;
  /** A sentence of detail. */
  body: string;
  /** Root-relative path. */
  link: string;
}

/**
 * Renders `export.ready`.
 *
 * @param data - the notification data.
 * @returns plain text and a root-relative link.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function exportReadyBrowserTemplate(data: ExportNotificationData): ExportBrowserContent {
  return {
    title: 'Your export is ready',
    body: `${data.sourceLabel} (${data.format.toUpperCase()}) is ready to download for a limited time.`,
    link: DATA_EXPORT_PAGE_PATH,
  };
}

/**
 * Renders `export.failed`.
 *
 * @param data - the notification data.
 * @returns plain text and a root-relative link.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function exportFailedBrowserTemplate(data: ExportNotificationData): ExportBrowserContent {
  return {
    title: 'Your export failed',
    body: `${data.sourceLabel} (${data.format.toUpperCase()}) could not be created. Please try again.`,
    link: DATA_EXPORT_PAGE_PATH,
  };
}
