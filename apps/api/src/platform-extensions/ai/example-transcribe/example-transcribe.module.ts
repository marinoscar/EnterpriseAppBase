import { Module } from '@nestjs/common';
import { AiCoreModule } from '@marinoscar/platform-api/ai';

import { ExampleTranscribeAdapter } from './example-transcribe.adapter';
import { EXAMPLE_TRANSCRIBE_TRANSPORT, FakeExampleTranscribeTransport } from './example-transcribe.transport';

/**
 * The example provider's Nest module (PP-14.6, issue #924): the
 * `AiProviderDefinition.module` of `app-registrations/ai.ts`. Being in the
 * module graph is the registration, as for the built-in provider modules:
 * `ExampleTranscribeAdapter.onModuleInit()` adds the adapter to
 * `AiProviderRegistry`. Whether the provider is ENABLED, in which region and
 * with which key is runtime configuration (the admin AI page), not wiring.
 *
 * The transport is the fake vendor. A fork replaces the `useClass` with its
 * real client; a test replaces the whole provider.
 */
@Module({
  imports: [AiCoreModule],
  providers: [
    { provide: EXAMPLE_TRANSCRIBE_TRANSPORT, useClass: FakeExampleTranscribeTransport },
    ExampleTranscribeAdapter,
  ],
  exports: [ExampleTranscribeAdapter, EXAMPLE_TRANSCRIBE_TRANSPORT],
})
export class ExampleTranscribeModule {}
