import type { AiProviderDefinition } from '@marinoscar/platform-api/ai';

import { EXAMPLE_TRANSCRIBE_PROVIDER_ID, exampleTranscribeSettingsSchema } from './example-transcribe.adapter';
import { ExampleTranscribeModule } from './example-transcribe.module';

/**
 * The example provider's definition (PP-14.6, issue #924): what the AI slice
 * needs to know about it before its adapter runs. `app-registrations/ai.ts`
 * registers it with `registerAiProvider`; a test hands it to
 * `createAiRuntimeHarness({ extraProviders })`.
 */
export const exampleTranscribeProvider: AiProviderDefinition = {
  id: EXAMPLE_TRANSCRIBE_PROVIDER_ID,
  label: 'Example Transcribe',
  description: 'A worked example of an app-side provider: transcription only, over a fake transport (no network).',
  module: ExampleTranscribeModule,
  // `region` is the provider's one non-secret setting; the generated admin form renders it as a select.
  settingsSchema: exampleTranscribeSettingsSchema,
  defaults: { region: 'us' },
  requiresKey: true,
  help: { key: 'The example vendor accepts any key except "example-rejected-key".' },
  // A real provider lists the npm package its adapter imports (`['assemblyai']`), so the
  // `ai-no-sdk-leak` suite bans it everywhere except this provider's own folder.
};
