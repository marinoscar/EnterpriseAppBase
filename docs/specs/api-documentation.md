# API Documentation

> Issue [#53](https://github.com/marinoscar/EnterpriseAppBase/issues/53), part of epic
> [#51](https://github.com/marinoscar/EnterpriseAppBase/issues/51). Implemented in
> `apps/api/src/openapi/`.

The interactive API reference at `/api/docs` and the OpenAPI document at
`/api/openapi.json`: what was wrong with the scaffold, what was decided instead, and why
each decision is load-bearing.

A note on issue numbers before anything else: source comments in `apps/api/src/openapi/`
cite this repo's own issue #53 and epic #51 throughout — unlike the DataTable and
navigation ports, nothing here carries a stray reference to the origin project's tracker.
Where this document cites #60, that is this repo's own bug report (below), not a borrowed
number.

---

## 1. What was wrong

`/api/docs` shipped as the untouched Nest/Swagger scaffold left it: titled **"Enterprise
App API"** at a hardcoded version `1.0`, rendered by stock Swagger UI over every controller
in whatever order Nest happened to register them, with no contact, no servers block, and no
way to obtain a token from the page — Google OAuth is a browser redirect Swagger UI cannot
drive, and the PAT and device-authorization flows existed but were undocumented as auth
options entirely.

Two problems were less visible on screen and more damaging underneath:

- **`cleanupOpenApiDoc()` — nestjs-zod's required post-processing step for `createZodDto`
  DTOs — was never called.** Every zod-derived request and response body therefore
  published an empty `{}` object schema. Roughly half the API surface was undocumented in
  practice: a reader saw a request or response type existed, and nothing about its shape.
- **Three `auth.controller.ts` methods called a bare `@ApiBearerAuth()`, with no scheme
  name, against a scheme the document never defined.** Not cosmetic: an undefined scheme
  gives the Authorize dialog nothing to attach a token to, so a reader who had "authorized"
  still got `401` from every one of those three operations. (The same three call sites still
  exist today, at `apps/api/src/auth/auth.controller.ts:174,245,280` — they are correct now
  because `@Auth()` and `document.ts` define `'JWT-auth'` as a real security scheme. See
  §3 for why these three stay bare `@ApiBearerAuth('JWT-auth')` rather than `@Auth()`.)
- **Almost every documented response shape was wrong regardless.** A global
  `TransformInterceptor` wraps every handler's return value in `{ data, meta }`, while
  `@ApiResponse({ type: Dto })` describes what the *handler* returns — so the published
  schema was consistently one level off from what actually went over the wire.

Also fixed along the way, as issue [#60](https://github.com/marinoscar/EnterpriseAppBase/issues/60):
`SwaggerModule.createDocument` threw on `z.date()` response DTOs (`user-response.dto.ts`,
`user-settings-response.dto.ts`, `system-settings-response.dto.ts`) because zod v4's
`toJSONSchema()` refuses to represent `z.date()` — JSON Schema has no native date type. This
crashed API *startup* in every environment, not just docs rendering, and was invisible to
the test suite because integration tests build the app through
`Test.createTestingModule(...)`, which never calls `SwaggerModule.createDocument`. The fix
was changing the four fields to ISO-8601 string types, which is also the type they actually
serialize as.

---

## 2. Shape of the solution

Everything that shapes the document lives in `apps/api/src/openapi/`, not in `main.ts`. The
reason is concrete: the spec is asserted by tests (`apps/api/test/openapi/openapi-document.spec.ts`)
and dumped by a CI script (`apps/api/scripts/dump-openapi.ts`), and neither of those can boot
a listening server. A pure `buildOpenApiConfig()` / `createOpenApiDocument(app)` pair is
callable from the test harness, the dump script, and `main.ts` alike — so the document CI
lints is the document a deployment actually serves.

| File | Responsibility |
| --- | --- |
| `document.ts` | `DocumentBuilder` config, security schemes, `buildOperationId`, and the fixed-order pass pipeline (`enrichOpenApiDocument`) |
| `description.ts` | The Markdown getting-started guide baked into `info.description` |
| `tags.ts` | Every tag name, its description, and its `x-tagGroups` section |
| `rbac-docs.ts` | Renders the `x-rbac` extension `@Auth()` stamps into operation descriptions |
| `data-envelope.ts` | Applies the `{ data: … }` wrapper the global interceptor produces |
| `nullable.ts` | Rewrites OpenAPI 3.0 `nullable: true` into 3.1 type unions |
| `docs-page.ts` | The Scalar reference page, including one-click session pre-authorization |
| `register-docs-routes.ts` | Registers `/api/docs` and `/api/openapi.json` as raw Fastify routes |
| `version.ts` | Resolves the application version for `info.version` |
| `types.ts` | Structural `DocOperation`/`MutableDocument` types and the shared `forEachOperation` walker |

`createOpenApiDocument(app)` runs Nest's own introspection (`SwaggerModule.createDocument`,
with a custom `operationIdFactory` and `ErrorDto` in `extraModels`), then `cleanupOpenApiDoc`
— nestjs-zod's recommended post-processing, without which every `createZodDto` class
publishes an empty `{}` schema, the single largest defect this module exists to fix — then
five passes in a **fixed order**, via `enrichOpenApiDocument`:

1. `applyRbacDocs` — render `x-rbac` into descriptions
2. `applyAlternativeAuthSchemes` — add the PAT scheme wherever a session token is accepted
3. `applyDataEnvelope` — wrap 2xx JSON responses in `{ data: … }`
4. `applyDefaultErrorResponse` — attach `ErrorDto` as every operation's `default` response
5. `applyTagGroups` — emit `x-tagGroups`, pruned to tags actually in use

`applyNullableFor31` runs **last, and must stay last**: every earlier pass may introduce
schemas of its own (the envelope pass wraps every response schema in a new object; the
error pass adds a `$ref` to `ErrorDto`), and the nullable rewrite has to see all of them. A
`nullable: true` that slips through past this point is not "mostly ignored" by a 3.1
consumer — it reads `type: "string"` and generates a non-nullable field, wrong about exactly
the values most likely to break a client.

Operation IDs are generated by `buildOperationId` (`document.ts`): `UsersController` /
`listUsers` becomes `users_listUsers`, not Nest's default `UsersController_listUsers`. The
controller stays a namespace — so two `list` handlers on different controllers cannot
collide — without baking `Controller` noise into every generated SDK method name.
Uniqueness is asserted in `test/openapi/openapi-document.spec.ts`.

---

## 3. Self-documenting RBAC

`@Auth()` (`apps/api/src/auth/decorators/auth.decorator.ts`) already knows the roles and
permissions it is about to enforce — that's what it hands to `RolesGuard` and
`PermissionsGuard`. It now also records them as an `x-rbac` vendor extension
(`ApiExtension(RBAC_EXTENSION_KEY, rbac)`), and `applyRbacDocs` renders that into the
operation description as a generated line:

> **Requires:** authentication, plus system role `admin` and permission `system_settings:write`.

**Why metadata plus a later pass, rather than writing the description directly in the
decorator.** Decorators evaluate bottom-up and `@nestjs/swagger` merges operation metadata
shallowly. A decorator that set `description` directly would race the controller's own
`@ApiOperation({ description })` — whichever ran last would silently clobber the other, and
which one that is depends on decorator order at each call site, which nobody reviews for
that. Post-processing appends instead (`rbac-docs.ts`'s `applyRbacDocs`), so hand-written
prose and the generated requirements line always coexist. The pass is idempotent: an
operation whose description already contains the `**Requires:**` marker is left alone, so
running it twice — a test, then a re-created document — can never stack duplicate blocks.

**The three bare `@ApiBearerAuth('JWT-auth')` calls on `auth.controller.ts` are deliberate,
not a leftover.** They sit on routes — chiefly on the auth controller and the
device-authorization controller — that compose `UseGuards(JwtAuthGuard)` directly rather than
`@Auth()`, because there is nothing for `RolesGuard`/`PermissionsGuard` to check on a route
whose whole job *is* authentication (`POST /api/auth/refresh`, for instance, has no RBAC
requirement beyond "you are signed in"). `describeRequirements` in `rbac-docs.ts` recognizes
this case specifically: no `x-rbac` extension, but a declared `security` requirement, and
renders the authentication-only line rather than staying silent about it.

**Two signals decide whether an operation is authenticated at all**
(`isAuthenticatedOperation` in `document.ts`): the `x-rbac` extension `@Auth()` stamps, or a
bare `security` entry naming the JWT scheme. Both are treated as "this needs a token" for
the purpose of §4 below (attaching the PAT alternative), because both really do.

---

## 4. Every authenticated route also accepts a PAT

`@Auth()` can only ever declare the session scheme — that is the one it names. But a
personal access token authenticates *every* authenticated route in this API: `JwtAuthGuard`
intercepts an `Authorization: Bearer pat_…` header and resolves it through
`PatService.validateToken` before it ever reaches the JWT passport strategy, setting the
same `AuthenticatedUser` shape on the request either way — so `RolesGuard` and
`PermissionsGuard` see identical input regardless of which credential arrived. That is a
fact a reader of the document needs and cannot get from `@Auth()` alone.

`applyAlternativeAuthSchemes` derives it instead of requiring every call site to declare it:
for every operation `isAuthenticatedOperation` recognizes, it appends the PAT scheme to
`security` if it isn't already present. Deriving it here — from the same marker the RBAC
line reads — keeps the claim accurate as routes are added, where a hand-applied
`@ApiSecurity()` on ~70 controllers would quietly go stale the first time someone forgot it
on a new endpoint. Multiple entries in an operation's `security` array are **alternatives**
(logical OR), so appending never tightens what the route actually requires.

---

## 5. The `{ data: … }` envelope

The audit that produced this module found the response-shape drift was structural, not a
handful of endpoints — so the fix is structural too. `applyDataEnvelope`
(`data-envelope.ts`) performs on the *document* exactly the transformation
`TransformInterceptor` performs on the *response*: a handler documented as returning `Dto`
is published as `{ data: Dto }`; a handler that already returns `{ data: Dto }` — resolved
one level through `$ref` into `components.schemas`, since a DTO named for the whole envelope
is indistinguishable from an inner type until resolved — is published unchanged, mirroring
the interceptor's own passthrough rule (`'data' in data`).

Deliberately untouched:

- **Non-2xx responses.** `HttpExceptionFilter` writes errors straight to the reply, bypassing
  every interceptor, so they are never enveloped. `applyDataEnvelope` filters on the status
  code (`/^2\d\d$/`) explicitly rather than relying on pass ordering to keep the two from
  meeting.
- **Responses with no `application/json` schema** — `204`, and anything that writes the
  reply itself. None declares a JSON schema, so filtering on that is exactly the right rule
  and needs no maintained allowlist.
- **Schemas that already declare a `data` property.** Double-wrapping one would publish
  `{ data: { data: … } }`, a shape the server never actually sends.

Editing every controller instead would have been a large, error-prone sweep that the next
new endpoint immediately reopens. `ApiDataResponse(Dto, options)` — a decorator in
`apps/api/src/common/decorators/api-data-response.decorator.ts` — exists for declaring the
envelope explicitly where a handler's payload has no DTO to point at (the paginated list
endpoints, whose shape is assembled in the service rather than typed), but the document pass
is what makes the whole surface correct without relying on every handler opting in.

---

## 6. OpenAPI 3.1, and the `nullable` trap it opens

The document is published as **OpenAPI 3.1** (`.setOpenAPIVersion('3.1.0')` in
`buildOpenApiConfig`), not the 3.0 default. This is required, not a preference: **zod v4
emits JSON Schema 2020-12**, which 3.1 adopts wholesale and 3.0 rejects outright. Under 3.0,
the zod-derived DTOs publish numeric `exclusiveMinimum` and `propertyNames` keywords that are
invalid there — a schema-validating consumer, and Spectral, would rightly fail on them.
Scalar renders 3.1 natively, which is a second reason to not fight the format it wants.

Switching versions opens one gap: `@nestjs/swagger`'s `@ApiProperty({ nullable: true })`
still emits the 3.0 spelling — a sibling `nullable: true` next to `type` — and 3.1 removed
that keyword entirely. A 3.1 consumer does not "mostly ignore" the stray keyword: it reads
`type: "string"` and generates a **non-nullable** field, wrong about exactly the values most
likely to break a client.

`applyNullableFor31` (`nullable.ts`) rewrites every occurrence into 3.1's spelling:
`type: ["string", "null"]` for a typed schema, or a nullable `$ref` into
`oneOf: [{ $ref }, { type: 'null' }]` — the only form 3.1 honours, since a `$ref` sibling
keyword is ignored under 3.0 and merged under 3.1, so neither spelling of a sibling keyword
is dependable. It walks the *whole* document rather than being fixed at each `@ApiProperty`
call site, because the next one anybody writes will use the 3.0 spelling too — `nullable` is
what the decorator's own TypeScript types document, so there is no way to write it "the 3.1
way" from the call site at all.

---

## 7. The reference page

`/api/docs` serves a [Scalar](https://scalar.com) reference: a sectioned searchable sidebar,
a built-in request client, generated code samples, dark mode, native OpenAPI 3.1 rendering.
`/api/openapi.json` remains the canonical machine-readable document; the page fetches it
rather than inlining it, so the served HTML stays small.

Both routes are registered directly on the Fastify instance by `register-docs-routes.ts`,
not through `SwaggerModule.setup` — which would additionally mount the stock Swagger UI on
the same path underneath Scalar. Registering directly also keeps both routes outside the
Nest guard pipeline, matching what `SwaggerModule.setup` already did, and keeping the
reference readable during maintenance-mode-style outages, which is exactly when an operator
is most likely to want it.

### 7.1 Why a hand-written template, not `@scalar/nestjs-api-reference`

That package renders a fixed template whose last statement is the
`Scalar.createApiReference(...)` call. The one-click session auth below (§7.2) has to
resolve a token *before* that call, so it can be handed to Scalar as pre-authorization
configuration rather than poked into Scalar's internal store afterwards — and that seam is
exactly what the packaged template does not expose, since nothing runs after its own final
statement. A ~60-line template this repo controls (`docs-page.ts`) beats string-surgery on
generated HTML.

### 7.2 One-click session auth

Landing on `/api/docs` while already signed in leaves the client pre-authorized. The page
`POST`s to `/api/auth/refresh` with `credentials: 'include'` and hands the returned access
token to Scalar as pre-authorization before mounting it. A reload re-runs the fetch, which is
what makes the authorization survive one.

Two constraints shaped this, both load-bearing:

- **It cannot be done server-side.** The refresh cookie is scoped to `path=/api/auth`
  (`refresh_token`'s cookie options in the auth module) and is therefore never sent to
  `/api/docs`. The exchange has to happen in the browser, where the cookie's path actually
  matches the request.
- **It cannot be done after mount.** Handing Scalar a token as configuration is clean;
  poking it into Scalar's internal store after `createApiReference` has already run is not
  a supported operation. So the fetch has to complete *before* that call — which, again, is
  the seam the packaged template's fixed structure does not expose.

`buildDocsAuthScript` is exported as a plain string, not a serialized function, on purpose:
a function put through `Function.prototype.toString()` carries whatever the compiler
emitted, including coverage instrumentation under `test:cov`, which would be broken
JavaScript once dropped into an actual `<script>` tag in a browser. `docs-auth-script.spec.ts`
**executes** the returned string against stubbed globals rather than pattern-matching the
markup for a `fetch('/api/auth/refresh')` substring — this distinction is not academic: an
earlier version of this exact check shipped broken because the test asserted the page
*contained* the right call and never actually ran it, so nothing noticed the response was
being read one JSON level too shallow (`body.accessToken` instead of `body.data.accessToken`,
because the response passes through the same `{ data, meta }` envelope as everything else).

### 7.3 Which schemes an operation offers

Handled by `applyAlternativeAuthSchemes`, described above in §4 — the session scheme comes
from `@Auth()`, and the PAT alternative is derived rather than hand-declared, so the claim
cannot go stale as routes are added.

### 7.4 The CDN

The Scalar bundle loads from a CDN by default, matching Scalar's own default. For a
self-hosted deployment that is a real constraint, so `API_DOCS_CDN` (read in `docs-page.ts`)
overrides the bundle URL — the escape hatch for an air-gapped deployment that wants to serve
the bundle from behind its own reverse proxy. The page itself is otherwise unchanged.

---

## 8. Two pagination shapes — documented, not unified

Every list endpoint is offset-paginated with `page` and `pageSize` query parameters, but the
response body comes in **two different shapes**, both wrapped in the `{ data: … }` envelope:

- **Flat** — `GET /api/users`, `GET /api/allowlist`. Counts sit beside `items`, inside `data`:

  ```json
  { "data": { "items": [ … ], "total": 42, "page": 1, "pageSize": 20, "totalPages": 3 } }
  ```

- **Nested** — `GET /api/storage/objects`. Counts sit in a `meta` object *inside* `data`, and
  the total is named `totalItems` rather than `total`:

  ```json
  { "data": { "items": [ … ], "meta": { "page": 1, "pageSize": 20, "totalItems": 42, "totalPages": 3 } } }
  ```

The nested shape's inner `meta` is a *different object* from the response envelope's own
`meta` (which carries only the server timestamp) — a client that reads `body.meta` off a
storage list response is reading pagination counts; the same read against a user list
response is reading nothing, because the flat shape has no inner `meta` at all. This is
documented both in `description.ts`'s getting-started guide and via
`ApiDataResponse(Dto, { pagination: 'flat' | 'nested' })`
(`apps/api/src/common/decorators/api-data-response.decorator.ts`), which types each list
endpoint's actual shape rather than a shape that would be nicer if the two agreed.

**Normalizing the two shapes is deliberately out of scope of this module and of issue #53.**
It is a real defect, not a design choice, and reconciling it is a breaking API change for
every existing client of `GET /api/users` and `GET /api/allowlist` — tracked separately, and
described faithfully here rather than quietly smoothed over in the document, because the
wire format is what it is today and a client reading this document has to handle both.

---

## 9. Quality gates

**Tag taxonomy.** `tags.ts` is the single declaration of every `@ApiTags(...)` name, its
description, and which `x-tagGroups` section it belongs to. Two rules are asserted rather
than left to review: no tag a controller uses that this file doesn't declare (renders
undescribed and ungrouped), and no tag this file declares that no controller uses (renders
an empty sidebar section). The second case is real here, not hypothetical: `TestAuthModule`
is registered only when `NODE_ENV !== 'production'`, so its `Test Authentication` tag is
used in development but not in a production dump — `applyTagGroups` prunes both `tags` and
`x-tagGroups` to tags actually in use on the finished document, which is what lets one
static taxonomy be correct in both environments.

**Operation IDs.** `buildOperationId` produces `users_listUsers` rather than Nest's default
`UsersController_listUsers` (§2). Uniqueness is asserted in
`test/openapi/openapi-document.spec.ts`.

**Tests.** `test/openapi/openapi-document.spec.ts` boots the real `AppModule` and asserts
the finished document (tag hygiene, operation-id uniqueness, every documented security
scheme actually declared in `components.securitySchemes`); `test/openapi/docs-routes.spec.ts`
covers the registered Fastify routes; each pass in `src/openapi/*.spec.ts` is covered in
isolation (`rbac-docs.spec.ts`, `data-envelope.spec.ts`, `nullable.spec.ts`, `version.spec.ts`,
`docs-page.spec.ts`, `docs-auth-script.spec.ts`).

**CI.** `apps/api/scripts/dump-openapi.ts` writes the finished document to a file, booting
the app with Nest's **preview mode** (`{ preview: true }`) — every module loaded and every
controller's metadata read, with no provider ever instantiated. That is what lets it run on
a bare CI checkout with no database, no object-storage credentials, and no cron or worker
loop started: the document is built entirely from decorator metadata, which preview mode has
in full. `NODE_ENV` is forced to `production` before anything else runs, so the dumped spec
is the one an actual deployment publishes — in particular, without the non-production `Test
Authentication` routes.

The `openapi` job in `.github/workflows/ci.yml` runs independently of the main build/test job
(no `needs:`, since it shares nothing with it and reads decorator metadata only), generates
the spec with `npm run openapi:dump`, and lints it with Spectral
(`npm run openapi:lint`, ruleset in `.spectral.yaml`) at `--fail-severity=error`. Every
relaxed rule in `.spectral.yaml` records why in a comment next to it — an unexplained `off`
is how a lint config stops meaning anything over time.

Locally:

```bash
npm run openapi:dump    # writes ./openapi.json
npm run openapi:lint    # Spectral
```

### 9.3 A failed document degrades; it does not take the API down

Generation runs during bootstrap, before `app.listen()`. Unguarded, that made any failure
to build the reference a total outage rather than a broken `/api/docs` — which is exactly
what [#60](https://github.com/marinoscar/EnterpriseAppBase/issues/60) was.

`registerDocsRoutesOrDegrade()` wraps it. On failure the error is logged with its stack,
`/api/docs` and `/api/openapi.json` return `503` with a body naming the problem, and every
other endpoint serves normally.

Three details are load-bearing:

- **It takes a thunk, not a document.** Passing an already-built document would leave the
  throw outside the guard, which guards nothing.
- **Nothing fallible runs after the first route is mounted.** Building handlers and
  mounting them are separate steps, because a failure surfacing after one route was
  registered would collide when mounting its replacement and throw *out of the catch* —
  reproducing the outage the guard exists to prevent.
- **The degraded page is standalone** — no CDN bundle, no spec fetch, no script. A
  fallback that needed the document to render would fail for the same reason the document
  did.

It is deliberately **not** gated on `NODE_ENV`. Gating would confine the recovery path to
the one environment nobody rehearses in, first exercised during the incident it exists to
soften; degrading everywhere means every test run and every local boot exercises the code
production depends on. The loud signal for developers already exists and is stronger than
a crash: `openapi:dump` in CI calls generation outside any guard and exits non-zero, so a
broken document still cannot merge.

The degraded body uses `code: 'OPENAPI_DOCUMENT_UNAVAILABLE'`, which is not one of
`ErrorDto`'s enumerated codes. These are raw Fastify routes that never reach
`HttpExceptionFilter` and never appear in the document, so the enum does not claim to
cover them, and the code the filter would derive for a 503 is its `ERROR` fallback, which
tells a client nothing.

---

## 10. Out of scope

- **Normalizing the two list-pagination shapes** (§8). A real defect, deliberately not fixed
  here because fixing it is a breaking change for existing clients.
- **Generating and publishing client SDKs.** Stable operation IDs and a valid 3.1 document
  make it possible; nothing here does it.
- **A hosted developer portal.** The reference stays same-origin at `/api/docs`.
- **Behavioral changes to any endpoint, auth flow, or permission.** The only additive
  runtime behavior introduced by this module is the docs page's own token-exchange helper.
- **Converting the remaining class-based `@ApiProperty` DTOs to zod.** `ErrorDto` is
  deliberately a class (nothing validates it — it is documentation-only, produced by the
  exception filter and never parsed on the way in); other DTOs converge to zod
  opportunistically, not as a sweep.
(Document generation *was* listed here as out of scope while
[#69](https://github.com/marinoscar/EnterpriseAppBase/issues/69) was open. It has since
shipped — see §9.3.)
