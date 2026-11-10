/**
 * A category key and its display label.
 *
 * @stability stable
 */
export interface DoctorCategoryLabel {
  /** The category key the API reports (`storage`). */
  key: string;
  /** What the page shows (`Object storage`). */
  label: string;
}

/**
 * The shipped categories, in display order, with their labels. The default of
 * `DoctorPage`'s `categories` prop; a category an app adds renders after these,
 * title-cased, unless the app passes its own list.
 *
 * @stability stable
 */
export const PLATFORM_DOCTOR_CATEGORY_LABELS: readonly DoctorCategoryLabel[] = [
  { key: 'core', label: 'Core' },
  { key: 'auth', label: 'Authentication' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'storage', label: 'Object storage' },
  { key: 'email', label: 'Email' },
  { key: 'push', label: 'Web Push' },
  { key: 'ai', label: 'AI' },
  { key: 'jobs', label: 'Job queue' },
  { key: 'nodes', label: 'Worker nodes' },
  { key: 'backup', label: 'Database backup' },
  { key: 'telemetry', label: 'Telemetry' },
];

/**
 * The label of a category: from `labels` when listed, otherwise the key
 * title-cased (`fork_widgets` becomes `Fork Widgets`).
 *
 * @param key - the category key.
 * @param labels - the known labels. Default {@link PLATFORM_DOCTOR_CATEGORY_LABELS}.
 * @returns the label.
 *
 * @stability stable
 */
export function categoryLabel(
  key: string,
  labels: readonly DoctorCategoryLabel[] = PLATFORM_DOCTOR_CATEGORY_LABELS,
): string {
  const known = labels.find((category) => category.key === key);
  if (known) return known.label;
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
