// =============================================================================
// Reference example: a document exporter on the kvox primitives (#744)
// =============================================================================
//
// For an app that renders ONE document into several formats (kvox's
// transcripts and notes), not datasets: an `ExporterRegistry<TDoc>` for the
// document type and one `Exporter<TDoc>` per format, whose `options` are
// declared once and give both the schema (`optionsSchemaFor`) and the dialog.
// `render` streams to `out` and ends it; a request's identity for reusing a
// rendered file is `hashExportRequest`. Not wired to a route here: the
// reference app has no documents. The spec under examples/exports/ drives it.
// =============================================================================

import { Injectable } from '@nestjs/common';
import {
  ExporterRegistry,
  endStream,
  failStream,
  hashExportRequest,
  optionsSchemaFor,
  writeChunk,
  type Exporter,
  type ExportOptionField,
  type ExportOptions,
} from '@marinoscar/platform-api/exports';

export interface ExampleDigestDocument {
  title: string;
  version: number;
  items: Array<{ at: Date; text: string }>;
}

/** The registry for this document type; `kind` names it in the boot log. */
@Injectable()
export class ExampleDigestExporterRegistry extends ExporterRegistry<ExampleDigestDocument> {
  protected override get kind(): string {
    return 'digest';
  }
}

const OPTIONS: readonly ExportOptionField[] = [
  { key: 'includeTimestamps', label: 'Timestamps', description: 'Prefix each line with its time.', type: 'boolean', default: true },
];

export const EXAMPLE_MARKDOWN_EXPORTER: Exporter<ExampleDigestDocument> = {
  format: 'markdown',
  label: 'Markdown',
  mimeType: 'text/markdown',
  extension: 'md',
  options: OPTIONS,
  optionsSchema: optionsSchemaFor(OPTIONS),
  async render(doc, options, out) {
    try {
      await writeChunk(out, `# ${doc.title}\n\n`);
      for (const item of doc.items) {
        const prefix = options.includeTimestamps ? `${item.at.toISOString()} ` : '';
        await writeChunk(out, `- ${prefix}${item.text}\n`);
      }
      await endStream(out);
    } catch (error) {
      throw failStream(out, error);
    }
  },
};

/** The identity a stored render is reused by. */
export function exampleDigestRenderKey(doc: ExampleDigestDocument, options: ExportOptions): string {
  return hashExportRequest({ format: EXAMPLE_MARKDOWN_EXPORTER.format, version: doc.version, options });
}
