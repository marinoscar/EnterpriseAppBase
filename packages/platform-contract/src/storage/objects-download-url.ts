import { z } from 'zod';

/**
 * The `GET /api/storage/objects/:id/download` payload: a signed URL and its lifetime.
 *
 * @stability experimental
 */
export const downloadUrlResponseSchema = z.object({
  /** Time-limited signed URL. Fetch it directly; it does not carry an Authorization header. */
  url: z.url(),
  /** Seconds until the URL stops working. */
  expiresIn: z.number().int().positive(),
});


/**
 * The `GET /api/storage/objects/:id/download` payload.
 *
 * @stability stable
 */
export type DownloadUrlResponse = z.infer<typeof downloadUrlResponseSchema>;
