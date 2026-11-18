import { createCli } from '@marinoscar/platform-cli';
import { listRegisteredProxyStreamPaths, registerProxyStreamPath } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { COACH_STREAM_PATHS } from './coach.proxy-stream.js';

// The proxy stream-path example (PP-14.22). The vhost rendering itself (the
// production bug) is pinned in the package: proxy-streams.test.ts.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

describe('COACH_STREAM_PATHS', () => {
  it('are not declared by the shipped CLI', () => {
    createCli(APP_CLI_OPTIONS);
    expect(listRegisteredProxyStreamPaths()).toEqual([]);
  });

  it('become unbuffered, long-lived locations once passed in proxy.streamPaths', () => {
    createCli({ ...APP_CLI_OPTIONS, proxy: { streamPaths: COACH_STREAM_PATHS } });
    expect(listRegisteredProxyStreamPaths()).toEqual([
      { path: '/api/coach/chat/stream', timeoutSeconds: 3600, buffering: false },
      { path: '/api/ai/training/stream', timeoutSeconds: 600, buffering: false },
    ]);
  });

  it('refuses a path that would inject nginx config, at createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, proxy: { streamPaths: ['/x; return 200'] } })).toThrow(/not allowed in a vhost location/);
    expect(() => registerProxyStreamPath('/x\n    proxy_pass http://evil;')).toThrow();
    expect(listRegisteredProxyStreamPaths()).toEqual([]);
  });
});
