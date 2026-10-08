// =============================================================================
// Reference example: an export source over a reference-app model (issue #744)
// =============================================================================
//
// `example-notification-inbox`: the caller's in-app notifications in a date
// range, as one dataset. It shows the three things an app source does:
//
//   1. a strict zod request schema (`from`, `to`, `unreadOnly`): the route and
//      the job both validate it, and the export dialog draws its fields from
//      it (`requestFieldsOf`: two date pickers and a checkbox);
//   2. a `collect` that pages its query by id with an EXPLICIT owner filter
//      (`ctx.db` is the bypass client) and yields rows lazily;
//   3. a `fileName` built from validated values only.
//
// Domain sources (EvoPath's `health`, kvox's `transcript`) follow the same
// shape and register from `app-registrations/exports.ts`.
// =============================================================================

import type { ExportContext, ExportRow, ExportSource, ExportTable } from '@marinoscar/platform-api/exports';
import { z } from 'zod';

const day = z.iso.date();

export const exampleNotificationInboxRequestSchema = z
  .object({
    from: day.optional().describe('First day, inclusive (UTC)'),
    to: day.optional().describe('Last day, inclusive (UTC)'),
    unreadOnly: z.boolean().default(false).describe('Only notifications you have not read'),
  })
  .strict()
  .refine((req) => !req.from || !req.to || req.from <= req.to, { message: '`from` must not be after `to`', path: ['to'] });

export type ExampleNotificationInboxRequest = z.infer<typeof exampleNotificationInboxRequestSchema>;

async function* inboxRows(ctx: ExportContext, req: ExampleNotificationInboxRequest): AsyncGenerator<ExportRow> {
  const where: Record<string, unknown> = { userId: ctx.subjectId };
  if (req.from || req.to) {
    where.createdAt = {
      ...(req.from ? { gte: new Date(`${req.from}T00:00:00.000Z`) } : {}),
      ...(req.to ? { lt: new Date(new Date(`${req.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
    };
  }
  if (req.unreadOnly) where.readAt = null;

  let after: string | undefined;
  for (;;) {
    const page = (await ctx.db.notification.findMany({
      where: after === undefined ? where : { AND: [where, { id: { gt: after } }] },
      select: { id: true, eventKey: true, title: true, body: true, readAt: true, createdAt: true },
      orderBy: { id: 'asc' },
      take: ctx.pageSize,
    })) as Array<{ id: string; eventKey: string; title: string; body: string; readAt: Date | null; createdAt: Date }>;
    for (const row of page) {
      yield {
        id: row.id,
        event: row.eventKey,
        title: row.title,
        body: row.body,
        read_at: row.readAt ? row.readAt.toISOString() : null,
        created_at: row.createdAt.toISOString(),
      };
    }
    if (page.length < ctx.pageSize) return;
    after = page[page.length - 1]!.id;
  }
}

export const EXAMPLE_NOTIFICATION_INBOX_SOURCE: ExportSource<ExampleNotificationInboxRequest> = {
  id: 'example-notification-inbox',
  scope: 'user',
  label: 'Notification inbox (example)',
  description: 'Your in-app notifications in a date range: a reference example of an app export source.',
  permission: 'user_settings:read',
  requestSchema: exampleNotificationInboxRequestSchema,
  formats: ['csv-single', 'json', 'csv', 'xlsx'],
  async *collect(ctx, req): AsyncGenerator<ExportTable> {
    yield {
      dataset: 'notifications',
      title: 'Notifications',
      columns: [
        { key: 'id', label: 'Id', type: 'string' },
        { key: 'event', label: 'Event', type: 'string' },
        { key: 'title', label: 'Title', type: 'string' },
        { key: 'body', label: 'Body', type: 'string' },
        { key: 'read_at', label: 'Read at', type: 'datetime' },
        { key: 'created_at', label: 'Created at', type: 'datetime' },
      ],
      rows: inboxRows(ctx, req),
    };
  },
  fileName(ctx, req, ext) {
    // Validated `YYYY-MM-DD` values and the source id only: always matches
    // EXPORT_FILE_NAME_PATTERN, so the header never needs escaping.
    const range = req.from || req.to ? `-${req.from ?? 'start'}-${req.to ?? ctx.now.toISOString().slice(0, 10)}` : '';
    return `notification-inbox${range}.${ext}`;
  },
};
