import type { AboutContributorDef } from '@marinoscar/platform-api/host';

// =============================================================================
// EXAMPLE: add a section to the About page (PP-14.13)
// =============================================================================
//
// `GET /api/admin/about` serves every registered contributor as
// `extras: [{ id, label, facts }]`, and the web About page renders each one as
// its own section after the platform's. Facts are strings, numbers and booleans;
// the rest is dropped, as is anything named like a credential. A contributor
// that throws or takes longer than two seconds is left out and the report still
// answers 200.
//
// Opt in with `registerHostExamples()` (`app-registrations/host.ts`).
// =============================================================================

/** A "Transcription" section: the provider the app uses and whether it is set up. */
export const transcriptionAboutContributor: AboutContributorDef = {
  id: 'transcription',
  label: 'Transcription',
  describe: () => ({ provider: 'example-transcribe', models: 2, batchOnly: true }),
};
