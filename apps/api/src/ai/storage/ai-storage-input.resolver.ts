// =============================================================================
// AiStorageInputResolver — storage objects as AI inputs (issue #437, epic #420)
// =============================================================================
//
// The one way the AI platform reads a user's file: an image to edit (#437),
// audio to transcribe (#438), a file a response reads (#441). Every one of
// those names its input by `storageObjectId`, never by bytes in a request
// body and never by a URL a provider would fetch, and every one needs the
// same two questions answered first:
//
//   1. MAY THIS CALLER USE THIS OBJECT? The caller uploaded it
//      (`uploaded_by_id`), or holds `storage:read_any`. The answers match
//      `ObjectsService` exactly: an unknown (or malformed) id is a 404
//      "Storage object not found", and somebody else's object is a 403 —
//      carrying `details.storageObjectId`, so the RBAC matrix (#435) can tell
//      it apart from a missing permission.
//   2. IS IT USABLE AS THIS INPUT? `ready` (a pending multipart upload has no
//      bytes yet), an allowed MIME type, not larger than the caller's cap.
//      Each is `AiError('AI_INVALID_REQUEST')` — a request the caller can fix.
//
// `resolve` answers both from the ROW ALONE — no storage call — so an HTTP
// route can refuse a bad input synchronously, before anything is queued.
// `read`/`open` fetch the bytes later (in the job), and `read` re-enforces
// the size cap while buffering: `storage_objects.size` is `0` for a simple
// upload until post-processing fills it in, so the row cannot be trusted to
// bound memory on its own.
//
// ⚠ Nothing here logs or returns a presigned URL; bytes stay server-side.
// =============================================================================

import { Readable } from 'node:stream';

import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../../storage/providers/storage-provider.interface';
import { AiError } from '../core/ai-error';
import type { AiBinaryPayload } from '../core/types/media.types';

/**
 * Reads ANY user's object. Listed in CLAUDE.md's RBAC model (Admin only) but
 * not seeded today, so in a stock deployment only an object's uploader can
 * use it — the check still asks the database, so a deployment that grants it
 * gets the documented behaviour with no code change.
 */
export const STORAGE_READ_ANY_PERMISSION = 'storage:read_any';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What an input must be. Every field is optional; omitted means "any". */
export interface AiStorageInputConstraints {
  /** Allowed MIME types (compared case-insensitively, parameters ignored). */
  mimeTypes?: readonly string[];
  /** Largest acceptable object, in bytes. */
  maxBytes?: number;
  /** How the input is named in error messages, e.g. `'image'` or `'mask'`. */
  label?: string;
}

/** A resolved, usable input — metadata only; fetch the bytes with `read`/`open`. */
export interface AiStorageInput {
  id: string;
  name: string;
  mimeType: string;
  /** As recorded on the row; `0` when not yet known (see the file header). */
  size: number;
  storageKey: string;
}

@Injectable()
export class AiStorageInputResolver {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * The object `objectId` as an input for `userId`, checked against
   * `constraints`. Reads the row only — never storage.
   *
   * @throws NotFoundException for an unknown or malformed id;
   *   ForbiddenException for another user's object without `storage:read_any`;
   *   AiError('AI_INVALID_REQUEST') for an object that is not ready, of a
   *   disallowed type, or too large.
   */
  async resolve(
    userId: string,
    objectId: string,
    constraints: AiStorageInputConstraints = {},
  ): Promise<AiStorageInput> {
    const row = UUID.test(objectId)
      ? await this.prisma.storageObject.findUnique({
          where: { id: objectId },
          select: { id: true, name: true, mimeType: true, size: true, storageKey: true, status: true, uploadedById: true },
        })
      : null;

    if (!row) {
      throw new NotFoundException('Storage object not found');
    }

    if (row.uploadedById !== userId && !(await this.canReadAny(userId))) {
      throw new ForbiddenException({
        message: 'You do not have access to this storage object',
        details: { storageObjectId: objectId },
      });
    }

    const label = constraints.label ?? 'input';

    if (row.status !== 'ready') {
      throw new AiError('AI_INVALID_REQUEST', `The ${label} storage object is not ready (status: ${row.status}).`, {
        details: { storageObjectId: objectId, status: row.status },
      });
    }

    const mimeType = normaliseMime(row.mimeType);

    if (constraints.mimeTypes && !constraints.mimeTypes.map(normaliseMime).includes(mimeType)) {
      throw new AiError(
        'AI_INVALID_REQUEST',
        `The ${label} storage object must be one of ${constraints.mimeTypes.join(', ')} (it is ${row.mimeType}).`,
        { details: { storageObjectId: objectId, mimeType: row.mimeType, allowed: [...constraints.mimeTypes] } },
      );
    }

    const size = Number(row.size);

    if (constraints.maxBytes !== undefined && size > constraints.maxBytes) {
      throw tooLarge(label, objectId, constraints.maxBytes);
    }

    return { id: row.id, name: row.name, mimeType, size, storageKey: row.storageKey };
  }

  /**
   * The input's bytes, buffered — for a provider SDK that wants a whole file.
   * Stops (and refuses with `AI_INVALID_REQUEST`) as soon as more than
   * `maxBytes` have arrived, whatever the row claimed.
   */
  async read(input: AiStorageInput, opts: { maxBytes?: number; label?: string } = {}): Promise<AiBinaryPayload> {
    const stream = await this.open(input);
    const chunks: Buffer[] = [];
    let total = 0;

    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);

        total += buffer.length;

        if (opts.maxBytes !== undefined && total > opts.maxBytes) {
          throw tooLarge(opts.label ?? 'input', input.id, opts.maxBytes);
        }

        chunks.push(buffer);
      }
    } finally {
      stream.destroy();
    }

    return { data: Buffer.concat(chunks, total), mimeType: input.mimeType, filename: input.name };
  }

  /** The input's bytes as a stream — for a consumer that can pipe them. */
  async open(input: AiStorageInput): Promise<Readable> {
    return this.storage.download(input.storageKey);
  }

  /** Whether `userId` holds `storage:read_any` through any role. One indexed query. */
  private async canReadAny(userId: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: {
        id: userId,
        userRoles: {
          some: { role: { rolePermissions: { some: { permission: { name: STORAGE_READ_ANY_PERMISSION } } } } },
        },
      },
    });

    return count > 0;
  }
}

function normaliseMime(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

function tooLarge(label: string, objectId: string, maxBytes: number): AiError {
  return new AiError('AI_INVALID_REQUEST', `The ${label} storage object is larger than ${maxBytes} bytes.`, {
    details: { storageObjectId: objectId, maxBytes },
  });
}
