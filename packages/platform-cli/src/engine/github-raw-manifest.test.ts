import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageError } from './errors.js';
import {
  DEFAULT_MANIFEST_TIMEOUT_MS,
  MAX_MANIFEST_BYTES,
  githubRawManifest,
  githubRawManifestUrl,
} from './github-raw-manifest.js';

// =============================================================================
// githubRawManifest  (issue #1033)
// =============================================================================
//
// Every network test goes through the `fetch` seam; nothing here opens a
// socket. The promises under test: only a valid semver `version` comes back;
// every other outcome is `undefined` and nothing throws; no credentials are
// sent; the body is capped; and the deadline holds even when the fetch ignores
// the abort signal.
// =============================================================================

const BASE = { repo: 'acme/coach', path: 'apps/cli/package.json' } as const;

type FetchArgs = Parameters<typeof fetch>;

function respond(body: string, init?: ResponseInit): typeof fetch {
  return vi.fn(async () => new Response(body, { status: 200, ...init })) as unknown as typeof fetch;
}

function lastRequest(fake: typeof fetch): { url: string; init: RequestInit } {
  const calls = (fake as unknown as { mock: { calls: FetchArgs[] } }).mock.calls;
  const [url, init] = calls[calls.length - 1] as FetchArgs;
  return { url: String(url), init: init ?? {} };
}

describe('githubRawManifestUrl', () => {
  it('builds an https raw.githubusercontent.com URL, defaulting the ref to main', () => {
    expect(githubRawManifestUrl(BASE)).toBe('https://raw.githubusercontent.com/acme/coach/main/apps/cli/package.json');
    expect(githubRawManifestUrl({ ...BASE, ref: 'release/1.x' })).toBe(
      'https://raw.githubusercontent.com/acme/coach/release/1.x/apps/cli/package.json',
    );
  });

  it.each(['', 'coach', 'acme/', '/coach', 'acme/coach/extra', 'a b/coach', 'acme/co ach', 'acme/..', '../coach', 'acme/coach?x=1', 'acme/coach#f', '-acme/coach', 'ac:me/coach', 'acme/co%61ch', 'https://evil/x'])(
    'rejects the repo %j',
    (repo) => {
      expect(() => githubRawManifestUrl({ ...BASE, repo })).toThrow(UsageError);
    },
  );

  it.each([undefined, null, 42])('rejects a non-string repo %j', (repo) => {
    expect(() => githubRawManifestUrl({ ...BASE, repo: repo as unknown as string })).toThrow(/owner\/name/);
  });

  it.each(['', '/etc/passwd', '../x/package.json', 'a/../b', 'a//b', './a', 'a/ b', 'a%2e%2e/b', 'a?b', 'a#b', 'a\\b', 'a/b/'])(
    'rejects the path %j',
    (path) => {
      expect(() => githubRawManifestUrl({ ...BASE, path })).toThrow(UsageError);
    },
  );

  it.each(['', '..', 'a/../b', '/main', 'main/', 'a b', 'a?b', 'a%20b'])('rejects the ref %j', (ref) => {
    expect(() => githubRawManifestUrl({ ...BASE, ref })).toThrow(UsageError);
  });

  it('accepts owners, repositories and refs GitHub allows', () => {
    expect(() => githubRawManifestUrl({ repo: 'my-org/my.repo_name-2', path: 'package.json', ref: 'v1.2.3' })).not.toThrow();
    expect(() => githubRawManifestUrl({ repo: 'a/b', path: 'a/b/c.json', ref: '0123456789abcdef' })).not.toThrow();
  });
});

describe('githubRawManifest: validation at build', () => {
  it('throws UsageError for a bad repo string before any request', () => {
    const fake = respond('{}');
    expect(() => githubRawManifest({ ...BASE, repo: 'not a repo', fetch: fake })).toThrow(UsageError);
    expect(fake).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects timeoutMs %s', (timeoutMs) => {
    expect(() => githubRawManifest({ ...BASE, timeoutMs })).toThrow(/timeoutMs/);
  });
});

describe('githubRawManifest: the request', () => {
  it('GETs the raw URL over https with no credentials and no redirect following', async () => {
    const fake = respond(JSON.stringify({ version: '1.2.3' }));

    await githubRawManifest({ ...BASE, fetch: fake })();

    const { url, init } = lastRequest(fake);
    expect(url).toBe('https://raw.githubusercontent.com/acme/coach/main/apps/cli/package.json');
    expect(url.startsWith('https://')).toBe(true);
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    const headerNames = Object.keys((init.headers ?? {}) as Record<string, string>).map((name) => name.toLowerCase());
    expect(headerNames).toEqual(['accept']);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the ref and path it is given', async () => {
    const fake = respond(JSON.stringify({ version: '1.2.3' }));
    await githubRawManifest({ repo: 'o/r', ref: 'release/2', path: 'cli/package.json', fetch: fake })();
    expect(lastRequest(fake).url).toBe('https://raw.githubusercontent.com/o/r/release/2/cli/package.json');
  });
});

describe('githubRawManifest: the answer', () => {
  it('returns the version of a good manifest', async () => {
    const latest = githubRawManifest({ ...BASE, fetch: respond(JSON.stringify({ name: 'x', version: '1.2.3', private: true })) });
    expect(await latest()).toBe('1.2.3');
  });

  it('accepts a prerelease and build metadata', async () => {
    expect(await githubRawManifest({ ...BASE, fetch: respond('{"version":"2.0.0-rc.1"}') })()).toBe('2.0.0-rc.1');
    expect(await githubRawManifest({ ...BASE, fetch: respond('{"version":"2.0.0+build.7"}') })()).toBe('2.0.0+build.7');
  });

  it.each([
    ['not json', 'this is not json'],
    ['truncated json', '{"version": "1.2.'],
    ['empty body', ''],
    ['a JSON array', '["1.2.3"]'],
    ['a JSON string', '"1.2.3"'],
    ['null', 'null'],
    ['no version', '{"name":"x"}'],
    ['a numeric version', '{"version":1.2}'],
    ['a null version', '{"version":null}'],
    ['an object version', '{"version":{"major":1}}'],
    ['a v-prefixed version', '{"version":"v1.2.3"}'],
    ['a two-part version', '{"version":"1.2"}'],
    ['a version with a newline', '{"version":"1.2.3\\n"}'],
    ['a version with an escape sequence', '{"version":"1.2.3\\u001b[2J"}'],
    ['a range, not a version', '{"version":"^1.2.3"}'],
  ])('returns undefined for %s', async (_label, body) => {
    expect(await githubRawManifest({ ...BASE, fetch: respond(body) })()).toBeUndefined();
  });

  it.each([404, 403, 301, 500, 503, 204])('returns undefined for status %i, even with a valid body', async (status) => {
    const fake = vi.fn(async () => new Response(status === 204 ? null : '{"version":"9.9.9"}', { status })) as unknown as typeof fetch;
    expect(await githubRawManifest({ ...BASE, fetch: fake })()).toBeUndefined();
  });

  it('returns undefined, never throws, when the fetch rejects (offline, DNS, refused redirect)', async () => {
    const fake = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(githubRawManifest({ ...BASE, fetch: fake })()).resolves.toBeUndefined();
  });

  it('returns undefined when the fetch throws synchronously', async () => {
    const fake = vi.fn(() => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    await expect(githubRawManifest({ ...BASE, fetch: fake })()).resolves.toBeUndefined();
  });
});

describe('githubRawManifest: the size cap', () => {
  it('rejects a response whose content-length is over the cap, without reading it', async () => {
    const read = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        read();
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const fake = vi.fn(
      async () => new Response(stream, { status: 200, headers: { 'content-length': String(MAX_MANIFEST_BYTES + 1) } }),
    ) as unknown as typeof fetch;

    expect(await githubRawManifest({ ...BASE, fetch: fake })()).toBeUndefined();
    expect(read.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('stops reading a body that grows past the cap with no content-length, and cancels it', async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fake = vi.fn(async () => new Response(stream, { status: 200 })) as unknown as typeof fetch;

    expect(await githubRawManifest({ ...BASE, fetch: fake })()).toBeUndefined();
    // 256 KiB / 64 KiB = 4 chunks fit; the fifth crosses the cap. A reader that
    // buffered the whole (endless) stream would never return.
    expect(pulled).toBeLessThan(10);
    expect(cancelled).toBe(true);
  });

  it('accepts a manifest just under the cap', async () => {
    const padding = ' '.repeat(MAX_MANIFEST_BYTES - 64);
    const body = `{"version":"3.0.0"}${padding}`;
    expect(body.length).toBeLessThanOrEqual(MAX_MANIFEST_BYTES);
    expect(await githubRawManifest({ ...BASE, fetch: respond(body) })()).toBe('3.0.0');
  });

  it('rejects a JSON body larger than the cap even though it is valid', async () => {
    const body = `{"version":"3.0.0","pad":"${'x'.repeat(MAX_MANIFEST_BYTES)}"}`;
    expect(await githubRawManifest({ ...BASE, fetch: respond(body) })()).toBeUndefined();
  });
});

describe('githubRawManifest: the deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to 1.5 seconds', () => {
    expect(DEFAULT_MANIFEST_TIMEOUT_MS).toBe(1500);
  });

  it('aborts the request and returns undefined when a fetch that honours the signal is slow', async () => {
    let aborted = false;
    const fake = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;

    const result = githubRawManifest({ ...BASE, fetch: fake })();
    await vi.advanceTimersByTimeAsync(DEFAULT_MANIFEST_TIMEOUT_MS);

    expect(await result).toBeUndefined();
    expect(aborted).toBe(true);
  });

  it('still returns at the deadline when the fetch ignores the signal and never settles', async () => {
    const fake = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;

    let settled = false;
    const result = githubRawManifest({ ...BASE, timeoutMs: 800, fetch: fake })().then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(799);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toBeUndefined();
  });

  it('times out a body that stalls after the headers arrive', async () => {
    const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) });
    const fake = vi.fn(async () => new Response(stalled, { status: 200 })) as unknown as typeof fetch;

    const result = githubRawManifest({ ...BASE, fetch: fake })();
    await vi.advanceTimersByTimeAsync(DEFAULT_MANIFEST_TIMEOUT_MS);

    expect(await result).toBeUndefined();
  });

  it('leaves no timer behind after a fast answer', async () => {
    await githubRawManifest({ ...BASE, fetch: respond('{"version":"1.0.0"}') })();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours the signal it is given: already aborted, and aborted mid-flight', async () => {
    const fake = respond('{"version":"1.0.0"}');
    const early = new AbortController();
    early.abort();
    expect(await githubRawManifest({ ...BASE, fetch: fake })(early.signal)).toBeUndefined();
    expect(fake).not.toHaveBeenCalled();

    const never = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const late = new AbortController();
    const result = githubRawManifest({ ...BASE, fetch: never })(late.signal);
    late.abort();
    expect(await result).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
