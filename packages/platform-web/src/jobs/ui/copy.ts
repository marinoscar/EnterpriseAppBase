// The jobs pages' titles and subtitles (issue #854): ONE string each, read by
// the page's `h1` and subtitle AND by its registry card in `settings.ts`, so
// the hub card, the Console rail row, the compact AppBar title and the page
// heading name the page identically. Moved from the reference app, where each
// page restated its card "word for word". Slice-internal.

export const JOBS_PAGE_TITLE = 'Jobs';
export const JOBS_PAGE_DESCRIPTION =
  'Inspect the background queue, retry or remove individual jobs, and recover work that stalled.';

export const JOB_INSIGHTS_PAGE_TITLE = 'Job Insights';
export const JOB_INSIGHTS_PAGE_DESCRIPTION =
  'See how long the queue takes, how fast it is moving, and when the outstanding work will be done.';
