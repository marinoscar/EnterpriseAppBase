// =============================================================================
// A pinned, bounded HTTP GET (PP-15.5, #1183)
// =============================================================================
//
// The read-side sibling of the webhook transport: one GET to an address the
// egress guard already checked (the `lookup` answers that address, so a second
// DNS answer cannot redirect the connection) while the URL's host name still
// drives the Host header, the TLS server name and certificate verification.
// NO redirect is followed (a 3xx is returned as it is), the whole exchange has
// a deadline, and the body is read only up to `maxBytes`: one byte more and the
// request is aborted and reported as `too_large`.
//
// A port (`PinnedGetTransport`) so a test scripts the answers and never touches
// the network.
// =============================================================================

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';

import type { ResolvedWebhookTarget } from './egress-guard';

/** One GET. @stability experimental */
export interface PinnedGetRequest {
  /** The checked target (from `resolveWebhookTarget`). */
  readonly target: ResolvedWebhookTarget;
  /** Request headers. */
  readonly headers: Readonly<Record<string, string>>;
  /** The deadline for the whole exchange, in milliseconds. */
  readonly timeoutMs: number;
  /** The most body bytes read; more is `too_large`. */
  readonly maxBytes: number;
}

/** What came back. @stability experimental */
export interface PinnedGetResponse {
  /** The HTTP status (a 3xx is NOT followed). */
  readonly status: number;
  /** The response headers, lower-cased names, first value of each. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body, at most `maxBytes` bytes. */
  readonly body: Buffer;
}

/** A transport failure with a stable code. @stability experimental */
export class PinnedGetError extends Error {
  constructor(
    /** `timeout`, `too_large` or `network`. */
    readonly code: 'timeout' | 'too_large' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'PinnedGetError';
  }
}

/**
 * Sends one GET. A port: the default is {@link nodePinnedGetTransport}.
 *
 * @stability experimental
 */
export interface PinnedGetTransport {
  /**
   * GETs `request`.
   *
   * @param request - the request.
   * @returns the response.
   * @throws PinnedGetError on a timeout, an oversized body or any network failure.
   */
  get(request: PinnedGetRequest): Promise<PinnedGetResponse>;
}

function isLiteral(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(':');
}

/**
 * The default transport (Node's `http(s).request`).
 *
 * @stability experimental
 */
export const nodePinnedGetTransport: PinnedGetTransport = {
  get(req) {
    const { target } = req;
    const secure = target.url.protocol === 'https:';
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if ((options as { all?: boolean }).all) {
        (callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(null, [{ address: target.address, family: target.family }]);
      } else {
        callback(null, target.address, target.family);
      }
    };

    return new Promise<PinnedGetResponse>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };

      const options = {
        method: 'GET',
        host: target.hostname,
        port: target.url.port === '' ? (secure ? 443 : 80) : Number(target.url.port),
        path: `${target.url.pathname}${target.url.search}`,
        headers: { ...req.headers },
        lookup: pinned,
        ...(secure && !isLiteral(target.hostname) ? { servername: target.hostname } : {}),
        agent: false as const,
      };

      const clientRequest = (secure ? httpsRequest : httpRequest)(options, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === 'string') headers[name.toLowerCase()] = value;
          else if (Array.isArray(value) && value[0] !== undefined) headers[name.toLowerCase()] = value[0];
        }
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > req.maxBytes) {
            finish(() => reject(new PinnedGetError('too_large', 'The response is larger than the limit.')));
            response.destroy();
            clientRequest.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => finish(() => resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) })));
        response.on('error', () => finish(() => reject(new PinnedGetError('network', 'Network error while reading the response.'))));
        response.on('close', () => finish(() => reject(new PinnedGetError('network', 'The connection closed early.'))));
      });

      const timer = setTimeout(() => {
        finish(() => reject(new PinnedGetError('timeout', 'The server did not answer in time.')));
        clientRequest.destroy();
      }, req.timeoutMs);
      timer.unref?.();

      clientRequest.on('error', (error: NodeJS.ErrnoException) => {
        // The message may name the host and port; never the path or query.
        finish(() => reject(new PinnedGetError('network', `Network error${error.code ? ` (${error.code})` : ''}.`)));
      });
      clientRequest.end();
    });
  },
};
