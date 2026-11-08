import type { FastifyInstance } from 'fastify';

/** The part route, as Fastify names it (`routeOptions.url`), under any global prefix. */
const PART_ROUTE = /\/storage\/objects\/:id\/upload\/parts\/:partNumber$/;

/**
 * Lets `PUT /api/storage/objects/:id/upload/parts/:partNumber` receive its body
 * as the UNREAD request stream, so a part is streamed to the driver and never
 * buffered. Call it once from the app's bootstrap, on the Fastify instance,
 * before `app.init()` / `listen()` (like every parser registration).
 *
 * It registers Fastify's `*` FALLBACK parser: the JSON, urlencoded, text and
 * multipart parsers still win for their own types, so a client may label the
 * part with the file's own type (`image/jpeg`) exactly as for an S3 presigned
 * PUT. Fastify cannot attach a parser to one route, so for every OTHER route the
 * fallback answers what Fastify already answered without it: 415 Unsupported
 * Media Type. The route enforces the exact part size while streaming, which is
 * a stronger bound than `bodyLimit` (that only governs buffering parsers).
 *
 * Without this call the part route answers 415 `RAW_BODY_REQUIRED`. Only an app
 * with a driver whose `partUploadMode` is `'proxied'` needs it.
 *
 * @param instance - the Fastify instance (`app.getHttpAdapter().getInstance()`).
 *
 * @example
 * ```ts
 * registerStoragePartBodyParser(app.getHttpAdapter().getInstance());
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function registerStoragePartBodyParser(instance: FastifyInstance): void {
  instance.addContentTypeParser('*', (request, payload, done) => {
    if (PART_ROUTE.test(request.routeOptions?.url ?? '')) {
      done(null, payload);
      return;
    }

    const error = new Error(`Unsupported Media Type: ${String(request.headers['content-type'])}`) as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 415;
    error.code = 'FST_ERR_CTP_INVALID_MEDIA_TYPE';
    done(error, undefined);
  });
}
