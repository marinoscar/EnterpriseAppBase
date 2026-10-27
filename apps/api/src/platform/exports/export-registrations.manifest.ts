// =============================================================================
// Export source and writer registrations (issue #744)
// =============================================================================
//
// Imported once, by `exports.config.ts`, before `ExportsModule.forRoot()`
// registers the platform's own sources and writers (both orders work: a
// source's formats are resolved when the sources are listed, and a re-
// registration of the same object is a no-op). The app's own entries come
// from `app-registrations/exports.ts`; the reference examples from
// `examples/exports/`.
// =============================================================================

import { registerExportSource, registerExportWriter } from '@marinoscar/platform-api/exports';

import { APP_EXPORT_SOURCES, APP_EXPORT_WRITERS } from '../../app-registrations/exports';
import { EXAMPLE_NOTIFICATION_INBOX_SOURCE } from '../../examples/exports/example-notification-inbox.source';
import { EXAMPLE_NDJSON_WRITER } from '../../examples/exports/example-ndjson.writer';
import { EXAMPLE_SINGLE_CSV_WRITER } from '../../examples/exports/example-single-csv.writer';

// The reference examples: a source over a reference-app model, a custom writer
// limited to it, and a writer attached to every source (offered on `user-data`
// and `org-data` too). A fork deletes these lines with `examples/`.
registerExportWriter(EXAMPLE_SINGLE_CSV_WRITER);
registerExportWriter(EXAMPLE_NDJSON_WRITER);
registerExportSource(EXAMPLE_NOTIFICATION_INBOX_SOURCE);

for (const writer of APP_EXPORT_WRITERS) registerExportWriter(writer);
for (const source of APP_EXPORT_SOURCES) registerExportSource(source);
