---
"@marinoscar/platform-web": minor
---

Add the Server-Sent Events client to `@marinoscar/platform-web/core` (#900): `connectSse` (reconnecting `GET` stream), `postSse` (one `POST`ed request, one streamed answer) and `SseParser`, moved from the reference app's `services/sse.ts` with their tests. `postSse` takes an optional `onErrorResponse` hook in place of the app's maintenance import; behaviour is otherwise unchanged.
