// The alerts UI's copy (issue #1047), in one place so a fork rewords it once.
// The card text and the page heading are the same words.

/**
 * The title, description and route of the Alerts page: the registry card's
 * text and the page's heading.
 *
 * @stability experimental
 */
export const ALERTS_PAGE_COPY: Readonly<{
  /** The card title and the page heading. */
  readonly title: string;
  /** The card text and the page lead. */
  readonly description: string;
  /** The route of the page. */
  readonly path: string;
}> = Object.freeze({
  title: 'Alerts',
  description:
    'Get told when something needs attention: metric thresholds, worker node events, offline nodes and the dashboard verdict, with the incidents they raised.',
  path: '/admin/settings/alerts',
});
