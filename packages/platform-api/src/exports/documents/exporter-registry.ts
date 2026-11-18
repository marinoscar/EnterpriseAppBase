// =============================================================================
// `Exporter<TDoc>` and `ExporterRegistry<TDoc>` (from kvox
// `export/exporter-registry.ts`, issues #28 and #54; packaged by #744)
// =============================================================================
//
// For an app that renders ONE DOCUMENT (a transcript, a note, a report) into
// several formats (Markdown, PDF, DOCX) rather than exporting datasets. The
// job-based framework (`registerExportSource` / `registerExportWriter`) is for
// tables; these two are the generic primitives kvox's transcript and note
// exports are built on, shipped so a second app does not write a third copy.
//
// `render` STREAMS; IT IS NOT ALLOWED TO RETURN A BUFFER. It writes the whole
// document to `out` and ENDS it; the promise settles once `out` finished; a
// failure rejects AND destroys `out`. A ten-hour recording's PDF runs to
// hundreds of pages, and a signature that returned bytes would make "never
// build the whole document in memory" unenforceable.
//
// `format` IS PERMANENT, like a job type: an app stores it on its export rows
// and in its request hash.
//
// PDF FONTS are documentation only (README, "PDF fonts"): every PDF in the
// apps is domain layout, so the platform ships no PDF writer and no font files.
// =============================================================================

import { Logger } from '@nestjs/common';
import type { Writable } from 'node:stream';

import type { ExportOptionField, ExportOptions, ExportOptionsSchema } from './export-options';

/**
 * One renderer, for one document type, in one format.
 *
 * @typeParam TDoc - the document type it renders.
 *
 * @stability experimental
 */
export interface Exporter<TDoc> {
  /** The registry key, and the app's stored format. Permanent. */
  readonly format: string;
  /** What the export dialog calls this format. */
  readonly label: string;
  /** Content type of the rendered file. */
  readonly mimeType: string;
  /** File extension, WITHOUT the dot. */
  readonly extension: string;
  /** The declarative option list: the one source of the schema below and of the dialog. */
  readonly options: readonly ExportOptionField[];
  /** Derived from `options` with `optionsSchemaFor`; never hand-written beside it. */
  readonly optionsSchema: ExportOptionsSchema;
  /** Writes the document to `out`. See the file header for the contract. */
  render(doc: TDoc, options: ExportOptions, out: Writable): Promise<void>;
}

/**
 * A registry of {@link Exporter}s for one document type. Each exporter
 * registers itself from its `onModuleInit`. Generic over the document type,
 * so a note exporter cannot land in the transcript registry by accident.
 *
 * @typeParam TDoc - the document type.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class NoteExporterRegistry extends ExporterRegistry<NoteDocument> {
 *   protected override get kind(): string { return 'note'; }
 * }
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export class ExporterRegistry<TDoc> {
  /** The registration log. */
  protected readonly logger: Logger = new Logger(ExporterRegistry.name);
  private readonly exporters = new Map<string, Exporter<TDoc>>();

  /**
   * Adds an exporter. A duplicate `format` OVERWRITES and warns (a fork
   * deliberately shadowing a shipped exporter), like `JobHandlerRegistry`.
   *
   * @param exporter - the exporter.
   */
  register(exporter: Exporter<TDoc>): void {
    if (this.exporters.has(exporter.format)) {
      this.logger.warn(`Export format "${exporter.format}" is already registered; the later registration wins`);
    }
    this.exporters.set(exporter.format, exporter);
    this.logger.log(`Registered ${this.kind} exporter "${exporter.format}" (${exporter.label})`);
  }

  /**
   * The exporter for `format`, or `undefined` (the caller owes a 400 naming
   * the formats that exist).
   *
   * @param format - the format id.
   * @returns the exporter, or `undefined`.
   */
  get(format: string): Exporter<TDoc> | undefined {
    return this.exporters.get(format);
  }

  /**
   * Every registered exporter, sorted by `format` (a stable, permanent key),
   * never in registration order.
   *
   * @returns the exporters.
   */
  all(): Exporter<TDoc>[] {
    return [...this.exporters.values()].sort((a, b) => (a.format < b.format ? -1 : a.format > b.format ? 1 : 0));
  }

  /**
   * The registered formats, sorted.
   *
   * @returns the format ids.
   */
  formats(): string[] {
    return this.all().map((exporter) => exporter.format);
  }

  /** What this registry's exporters render, for the registration log line. A subclass overrides it. */
  protected get kind(): string {
    return 'document';
  }
}
