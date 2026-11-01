// =============================================================================
// The webhook HTTP transport (issue #1046)
// =============================================================================
//
// One POST to a checked, PINNED address. Node's `http(s).request` with a
// `lookup` that answers the address the guard approved (so a second DNS answer
// cannot redirect the connection) while the URL's host name still drives the
// Host header, the TLS server name and certificate verification. No redirect is
// followed (the platform's HTTP client never does), the whole exchange has a
// deadline, and only the first KiB of the response body is read.
// =============================================================================

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';

import { WEBHOOK_SNIPPET_MAX } from '../webhooks.constants';
import type { ResolvedWebhookTarget } from './egress-guard';

/** One request. @stability experimental */
export interface WebhookTransportRequest {
  /** The checked target. */
  readonly target: ResolvedWebhookTarget;
  /** The request headers (content type, user agent, the three signing headers). */
  readonly headers: Readonly<Record<string, string>>;
  /** The exact body. */
  readonly body: string;
  /** The deadline for the whole exchange. */
  readonly timeoutMs: number;
}

/** What came back. @stability experimental */
export interface WebhookTransportResponse {
  /** The HTTP status. */
  readonly status: number;
  /** The `Retry-After` header, raw, when present. */
  readonly retryAfter: string | null;
  /** The first `WEBHOOK_SNIPPET_MAX` characters of the body, control characters removed. */
  readonly snippet: string;
}

/** A transport failure with a stable code. @stability experimental */
export class WebhookTransportError extends Error {
  constructor(
    /** `timeout` or `network`. */
    readonly code: 'timeout' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'WebhookTransportError';
  }
}

/**
 * Sends one request. A port: the default is {@link nodeWebhookTransport}; the
 * slice's testing entry has a recording fake.
 *
 * @stability experimental
 */
export interface WebhookTransport {
  /**
   * POSTs `request`.
   *
   * @param request - the request.
   * @returns the response.
   * @throws WebhookTransportError on a timeout or any network failure.
   */
  send(request: WebhookTransportRequest): Promise<WebhookTransportResponse>;
}

/** Removes control characters and caps the length. */
export function toSnippet(raw: string): string {
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, WEBHOOK_SNIPPET_MAX);
}

/**
 * The default transport.
 *
 * @stability experimental
 */
export const nodeWebhookTransport: WebhookTransport = {
  send(req) {
    const { target } = req;
    const secure = target.url.protocol === 'https:';
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if ((options as { all?: boolean }).all) {
        (callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(null, [{ address: target.address, family: target.family }]);
      } else {
        callback(null, target.address, target.family);
      }
    };

    return new Promise<WebhookTransportResponse>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };

      const options = {
        method: 'POST',
        host: target.hostname,
        port: target.url.port === '' ? (secure ? 443 : 80) : Number(target.url.port),
        path: `${target.url.pathname}${target.url.search}`,
        headers: { ...req.headers, 'content-length': String(Buffer.byteLength(req.body)) },
        lookup: pinned,
        // Verify the certificate against the host NAME, not the pinned address.
        ...(secure && !isLiteral(target.hostname) ? { servername: target.hostname } : {}),
        agent: false as const,
      };

      const clientRequest = (secure ? httpsRequest : httpRequest)(options, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const retryAfter = typeof response.headers['retry-after'] === 'string' ? response.headers['retry-after'] : null;
        const done = (): void =>
          finish(() =>
            resolve({
              status: response.statusCode ?? 0,
              retryAfter,
              snippet: toSnippet(Buffer.concat(chunks).toString('utf8')),
            }),
          );
        response.on('data', (chunk: Buffer) => {
          if (size < WEBHOOK_SNIPPET_MAX * 4) {
            chunks.push(chunk);
            size += chunk.length;
          }
          if (size >= WEBHOOK_SNIPPET_MAX * 4) {
            response.destroy();
            done();
          }
        });
        response.on('end', done);
        response.on('error', () => done());
        response.on('close', done);
      });

      const timer = setTimeout(() => {
        finish(() => reject(new WebhookTransportError('timeout', 'The receiver did not answer in time.')));
        clientRequest.destroy();
      }, req.timeoutMs);
      timer.unref?.();

      clientRequest.on('error', (error: NodeJS.ErrnoException) => {
        // The message may name the host and port; never the path or query.
        finish(() => reject(new WebhookTransportError('network', `Network error${error.code ? ` (${error.code})` : ''}.`)));
      });
      clientRequest.end(req.body);
    });
  },
};

function isLiteral(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(':');
}

/** Injection token of the {@link WebhookTransport}. @stability experimental */
export const WEBHOOKS_TRANSPORT: unique symbol = Symbol.for('@marinoscar/platform/webhooks/TRANSPORT');
/** Injection token of the {@link HostResolver}. @stability experimental */
export const WEBHOOKS_RESOLVER: unique symbol = Symbol.for('@marinoscar/platform/webhooks/RESOLVER');
