// supertest, loaded when a suite first calls it (issue #742).
//
// `supertest` is an optional peer of `@marinoscar/platform-api`: only the AI
// conformance suites drive the app over HTTP. A top-level `import` would make
// `@marinoscar/platform-api/ai/testing` (which also exports the scripted fake
// provider and the runtime harness) fail to load in an app that does not install
// it, so the suites go through this wrapper and the module is required lazily.

import type supertest from 'supertest';

/** The response type supertest resolves a request to. */
export type SupertestResponse = supertest.Response;

/**
 * `supertest(app)`, with the module required on first use.
 *
 * @param app - the HTTP server of the booted app.
 * @returns the supertest agent for it.
 * @throws Error when `supertest` is not installed, naming the peer to add.
 *
 * @stability experimental
 */
export function request(app: Parameters<typeof supertest>[0]): ReturnType<typeof supertest> {
  let load: typeof supertest;
  try {
    load = require('supertest') as typeof supertest;
  } catch (cause) {
    throw new Error(
      `The AI conformance suites drive the app over HTTP with supertest, an optional peer of @marinoscar/platform-api: install it (npm install --save-dev supertest). ${(cause as Error).message}`,
    );
  }

  return load(app);
}
