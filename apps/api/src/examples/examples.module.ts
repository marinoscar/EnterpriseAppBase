// =============================================================================
// ExamplesModule: the reference app's worked examples of platform seams
// (issue #734)
// =============================================================================
//
// Code that exists to SHOW an extension point, wired exactly as a fork's own
// would be. Today: the job-handler registry seam (`registry.register(this)`
// from `onModuleInit`), with one server-only handler (`example.echo`) and one
// node-eligible handler (`example.checksum`: `nodeResultSchema` +
// `persistNodeResult`, the only way a type becomes node-eligible), and a label
// for a handler-less type (`jobs/job-type-labels.example.ts`). The ambient
// organization scope (`jobs/ambient-org-scope.example.ts`) is a shape, not
// bound: core has no request-scoped organization yet. They lived
// inside the queue until the jobs slice was packaged; a package ships no
// examples, so they live here, where the slice README's catalog links them.
//
// Registered on every boot on purpose: the self-registration of a real
// handler is exercised by every start, and `example.checksum` is the type
// that lets the node fleet be tested end to end (see its header).
// =============================================================================

import { Module, type OnModuleInit } from '@nestjs/common';

import { ObjectProcessingModule, StorageProvidersModule } from '@marinoscar/platform-api/storage';
import { ExampleChecksumHandler } from './jobs/example-checksum.handler';
import { ExampleEchoHandler } from './jobs/example-echo.handler';
import { registerExampleJobTypeLabels } from './jobs/job-type-labels.example';
import { ExampleMetadataProcessor } from './storage/example-metadata.processor';

@Module({
  // `example.checksum` reads object bytes server-side when no node takes it:
  // `STORAGE_PROVIDER`, never the whole storage module.
  // `ObjectProcessingModule` (#736): the processor registry the example
  // metadata processor registers itself with.
  imports: [StorageProvidersModule, ObjectProcessingModule],
  providers: [ExampleEchoHandler, ExampleChecksumHandler, ExampleMetadataProcessor],
  exports: [ExampleEchoHandler, ExampleChecksumHandler, ExampleMetadataProcessor],
})
export class ExamplesModule implements OnModuleInit {
  onModuleInit(): void {
    registerExampleJobTypeLabels();
  }
}
