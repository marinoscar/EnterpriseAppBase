// =============================================================================
// The `{ data }` envelope opt-out for protocol endpoints (PP-15.4, #1182)
// =============================================================================
//
// `TransformInterceptor` (host slice) wraps every JSON body as
// `{ data, meta }`. An endpoint whose body is dictated by an external
// specification cannot be wrapped: the OAuth token endpoint (RFC 6749 §5.1), the
// authorization server metadata document (RFC 8414) and the protected resource
// metadata (RFC 9728) are parsed by third-party clients that look for
// `access_token` or `issuer` at the TOP LEVEL.
//
// The error side of the same problem already has an explicit brand
// (`withVerbatimErrorBody`); this is the success side. It is a decorator, never
// a sniff of the returned keys, for the reason the error brand gives: an
// endpoint's wire shape must not depend on which key names a handler happened
// to return. It also stamps the OpenAPI operation with `x-raw-response`, so the
// generated document stops describing the envelope for it
// (`applyDataEnvelope` skips such an operation).
//
// Core, not host: the identity slice sits below the host slice and needs it.
// =============================================================================

import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

/**
 * Reflector key stamped by {@link RawResponse}.
 *
 * @stability experimental
 */
export const RAW_RESPONSE_KEY = 'platform:rawResponse';

/**
 * The OpenAPI vendor extension {@link RawResponse} stamps on the operation.
 *
 * @stability experimental
 */
export const RAW_RESPONSE_OPENAPI_EXTENSION = 'x-raw-response';

/**
 * Exempts a handler from the `{ data, meta }` response envelope: its return
 * value is the response body, exactly as the protocol specifies it. Use it only
 * when an external standard dictates the body (the OAuth token and metadata
 * endpoints); NOT to give an endpoint a nicer shape. Errors are a separate
 * matter: see `withVerbatimErrorBody`.
 *
 * @returns a method decorator.
 *
 * @example
 * ```ts
 * @Get('.well-known/authorization-server')
 * @RawResponse()
 * metadata() { return { issuer: 'https://app.example.test' }; }
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export const RawResponse = (): MethodDecorator =>
  applyDecorators(SetMetadata(RAW_RESPONSE_KEY, true), ApiExtension(RAW_RESPONSE_OPENAPI_EXTENSION, true)) as MethodDecorator;

/**
 * Whether the reflected metadata of a handler marks it raw.
 *
 * @param reflected - the value `Reflect.getMetadata(RAW_RESPONSE_KEY, handler)` returned.
 * @returns `true` for an exempt handler.
 *
 * @stability experimental
 */
export function isRawResponse(reflected: unknown): boolean {
  return reflected === true;
}
