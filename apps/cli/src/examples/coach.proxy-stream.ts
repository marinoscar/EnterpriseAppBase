// =============================================================================
// EXAMPLE, NOT WIRED: app routes the VPS host proxy must stream (PP-14.22)
// =============================================================================
//
// THE PRODUCTION BUG THIS FIXES. An app's SSE route works through the app's own
// nginx (`infra/nginx/app.d/locations`, see the `*.conf.example` files there),
// but the SHARED host proxy in front of the stack knew only the platform's
// three SSE paths. Everything else fell under `location /`: buffered, and cut
// at 60 seconds. A chat answer arrived in one lump or died mid-sentence, and
// only on a VPS.
//
// Declare the paths in the app's CLI options and the vhost `deploy install` /
// `deploy update` writes carries one unbuffered, long-lived location per path,
// with the same directives as the platform's own SSE locations:
//
//   createCli({ ..., proxy: { streamPaths: COACH_STREAM_PATHS } })
//
// or `registerProxyStreamPath(path)` before `createCli`. The paths are
// validated before they reach the shared nginx config (a leading `/`, URL-safe
// characters only, no `;`, quotes, braces, `$`, `#` or whitespace), because a
// malformed vhost breaks `nginx -t` for every site on the server.
//
// EvoPath's two routes are the shape: a chat stream and a training stream.
// =============================================================================

/** Matches `infra/nginx/app.d/locations` (and the CSP-free fixture in platform-infra's tests). */
export const COACH_STREAM_PATHS = [
  '/api/coach/chat/stream',
  // A longer answer: ten minutes instead of the default hour is plenty.
  { path: '/api/ai/training/stream', timeoutSeconds: 600 },
] as const;
