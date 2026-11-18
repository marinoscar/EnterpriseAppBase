// =============================================================================
// InProcessDelegation: a protected resource calling the app's own routes (PP-15.3)
// =============================================================================
//
// A resource such as an MCP endpoint serves an `oat_` token and then calls the
// app's own REST routes with `fastify.inject`. Those routes are outside the
// resource's route prefix, so the `oat_` header would be refused by route
// confinement, and FORWARDING it would defeat audience binding (the token would
// be a bearer for every route). The platform provides a delegation instead:
//
//   `Bearer ipd_<id>.<mac>`
//
//   id   16 random bytes, hex. Maps to an in-memory entry holding the
//        originating request's user graph, credential info, principal (the
//        narrowed permissions live on both) and `expiresAt = now + 60 s`.
//   mac  HMAC-SHA-256 of the id under a key generated at process start. The
//        key is never stored or logged. A guessed id is useless.
//
// THE INVARIANT: a delegation is unusable from the network and unusable after
// its originating request ends.
//
//   * Unusable from the network. The guard accepts an `ipd_` header only when
//     the request's RAW SOCKET carries this process's marker address: the
//     `inject` below passes `remoteAddress: <marker>` to `fastify.inject`
//     (light-my-request builds a mock socket from it). A real connection's
//     `socket.remoteAddress` is the kernel's peer address, always an IP, so it
//     can never equal the marker, whatever headers or `trustProxy` setting say.
//     `InProcessDelegation.inject` is the only API that sets the marker. A
//     network request carrying an `ipd_` header is a `401` and a warning (the
//     header is never logged).
//   * Unusable after the originating request ends. Entries are dropped by an
//     `onResponse` hook on the originating request, and expire after 60 s
//     whichever comes first.
//
// The delegated request has the same principal, credential kind (`oauth` for
// an OAuth caller) and narrowed permissions, and skips route confinement,
// which is its purpose. It works for session and PAT principals too, so a
// resource has ONE code path.
// =============================================================================

import { HttpAdapterHost } from '@nestjs/core';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, InjectOptions, LightMyRequestResponse } from 'fastify';

import type { Principal } from '../../core/index';
import type { AuthCredentialInfo } from '../auth/decorators/auth-credential.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

/**
 * The `Authorization` prefix of a delegation.
 *
 * @stability experimental
 */
export const IPD_BEARER_PREFIX = 'Bearer ipd_';

/**
 * How long a delegation lives at most, in milliseconds.
 *
 * @stability experimental
 */
export const IPD_TTL_MS = 60_000;

/**
 * What a delegated request is authenticated as.
 *
 * @stability experimental
 */
export interface InProcessDelegationEntry {
  /** The originating request's user graph (carries any OAuth narrowing). */
  readonly user: AuthenticatedUser;
  /** The originating credential, as the guard recorded it. */
  readonly authCredential: AuthCredentialInfo;
  /** The originating principal. */
  readonly principal: Principal;
  /** When the entry stops being usable (epoch ms). */
  readonly expiresAt: number;
}

interface DelegatingRequest {
  user?: AuthenticatedUser;
  principal?: Principal;
  authCredential?: AuthCredentialInfo;
  server?: FastifyInstance;
}

/**
 * Issues and redeems in-process delegations. Provided by the OAuth server
 * module (global): inject it in a resource's controller.
 *
 * @example
 * ```ts
 * // inside a handler under the resource's prefix
 * const res = await this.delegation.inject(request, { method: 'GET', url: '/api/notes' });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
@Injectable()
export class InProcessDelegation implements OnModuleInit {
  private readonly logger = new Logger(InProcessDelegation.name);
  /** Per-process HMAC key. Never stored, logged or exposed. */
  private readonly key = randomBytes(32);
  /** The socket address only `inject` produces; a real peer address is always an IP. */
  private readonly marker = `ipd-${randomBytes(12).toString('hex')}`;
  private readonly entries = new Map<string, InProcessDelegationEntry>();
  private readonly byRequest = new WeakMap<object, Set<string>>();

  constructor(@Optional() private readonly adapterHost?: HttpAdapterHost) {}

  /** Installs the `onResponse` hook that drops a request's delegations when it ends. */
  onModuleInit(): void {
    const instance = this.adapterHost?.httpAdapter?.getInstance?.() as FastifyInstance | undefined;
    if (!instance || typeof instance.addHook !== 'function') return;
    instance.addHook('onResponse', (request, _reply, done) => {
      this.dropFor(request);
      done();
    });
  }

  /**
   * The `Authorization` value for the CURRENT request's principal, whatever its
   * credential kind. Only {@link inject} (or a `fastify.inject` call that passes
   * {@link remoteAddressForInject} as `remoteAddress`) can use it.
   *
   * @param request - the originating request (authenticated: `@Auth()` ran).
   * @returns `Bearer ipd_<id>.<mac>`.
   * @throws Error when the request carries no authenticated principal.
   */
  headerFor(request: object): string {
    const source = request as DelegatingRequest;
    if (!source.user || !source.principal || !source.authCredential) {
      throw new Error('InProcessDelegation.headerFor needs an authenticated request (a route behind @Auth())');
    }
    this.sweep();
    const id = randomBytes(16).toString('hex');
    this.entries.set(id, {
      user: source.user,
      authCredential: source.authCredential,
      principal: source.principal,
      expiresAt: Date.now() + IPD_TTL_MS,
    });
    let owned = this.byRequest.get(request);
    if (!owned) this.byRequest.set(request, (owned = new Set()));
    owned.add(id);
    return `${IPD_BEARER_PREFIX}${id}.${this.mac(id)}`;
  }

  /**
   * Calls one of the app's own routes as the originating request's principal:
   * the delegated request keeps its credential kind and narrowed permissions
   * and skips route confinement.
   *
   * @param request - the originating request.
   * @param options - `fastify.inject` options (`method`, `url`, `payload`, ...); an `authorization` header in them is replaced.
   * @returns the injected response.
   */
  inject(request: FastifyRequest, options: InjectOptions): Promise<LightMyRequestResponse> {
    const server = (request as DelegatingRequest).server;
    if (!server) throw new Error('InProcessDelegation.inject needs the originating FastifyRequest');
    const headers = { ...(options.headers ?? {}) } as Record<string, string | string[] | undefined>;
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'authorization') delete headers[name];
    headers.authorization = this.headerFor(request);
    return server.inject({ ...options, headers, remoteAddress: this.marker } as InjectOptions) as Promise<LightMyRequestResponse>;
  }

  /** The `remoteAddress` a `fastify.inject` call must carry for the guard to honour a delegation header. */
  remoteAddressForInject(): string {
    return this.marker;
  }

  /**
   * Whether `request` reached this process in-process through {@link inject}
   * (its raw socket carries the marker) rather than over the network.
   */
  isInProcess(request: { raw?: { socket?: { remoteAddress?: unknown } } }): boolean {
    return request.raw?.socket?.remoteAddress === this.marker;
  }

  /**
   * Redeems a delegation header value.
   *
   * @param authorization - the whole `Authorization` header (`Bearer ipd_<id>.<mac>`).
   * @returns the entry, or `null` for a malformed, forged, expired or dropped delegation.
   */
  redeem(authorization: string): InProcessDelegationEntry | null {
    const raw = authorization.slice(IPD_BEARER_PREFIX.length);
    const dot = raw.indexOf('.');
    if (dot <= 0) return null;
    const id = raw.slice(0, dot);
    const mac = raw.slice(dot + 1);
    const expected = Buffer.from(this.mac(id));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(id);
      return null;
    }
    return entry;
  }

  /** Logs the refusal of an `ipd_` header that did not come from `inject` (never the header). */
  warnNetworkAttempt(): void {
    this.logger.warn('Refused an in-process delegation credential presented over the network');
  }

  /** Drops every delegation `request` issued (the `onResponse` hook calls it). */
  dropFor(request: object): void {
    const owned = this.byRequest.get(request);
    if (!owned) return;
    for (const id of owned) this.entries.delete(id);
    this.byRequest.delete(request);
  }

  /** How many delegations are live (tests, metrics). */
  size(): number {
    return this.entries.size;
  }

  private mac(id: string): string {
    return createHmac('sha256', this.key).update(id).digest('base64url');
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
  }
}
