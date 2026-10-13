import {
  registerCredentialKind,
  registerErrorCode,
  registerSystemAccessReason,
  type ErrorMapper,
} from '@marinoscar/platform-api/core';

import { apiKeyCredentialKind } from '../platform-extensions/core/api-key.credential-kind';
import { greeterKind, plainGreeter, signedGreeter } from '../platform-extensions/core/greeter.kind';
import { noteTitleTakenCode } from '../platform-extensions/core/note-title-taken.error-code';
import {
  prismaUniqueViolationMapper,
  resourceAlreadyExistsCode,
} from '../platform-extensions/core/prisma-unique-violation.mapper';
import { transcriptReindexReason } from '../platform-extensions/core/transcript-reindex.job';

// =============================================================================
// This app's core registrations (PP-14.5, PP-14.14)
// =============================================================================
//
// Register an app's own entries here, AT IMPORT TIME: every registry below
// freezes once the application has bootstrapped. Unlike the pure-data files of
// this folder, this one makes the `register` calls itself, like `host.ts`;
// whatever needs an entry must import it before the container is created.
//
// The reference app registers worked examples. None is consumed by a running
// platform slice, so nothing in the running app imports this file; the example
// specs do (`test/examples/core/`). A fork deletes the lines it does not want and
// registers its own.
//
//   - pluggable kind `greeter` (PP-14.5): `platform-extensions/core/greeter.kind.ts`
//   - system access reason `transcript-reindex`: `.../transcript-reindex.job.ts`.
//     Registering a reason opens WHICH reason a bypass may name, never WHO may
//     bypass: the injection allowlist of
//     `test/tenancy/system-injection-boundary.spec.ts` is unchanged.
//   - credential kind `api-key`: `.../api-key.credential-kind.ts`
//   - error codes `NOTE_TITLE_TAKEN`, `RESOURCE_ALREADY_EXISTS`: `.../note-title-taken.error-code.ts`,
//     `.../prisma-unique-violation.mapper.ts`
// =============================================================================

greeterKind.register(plainGreeter);
greeterKind.register(signedGreeter);

registerSystemAccessReason(transcriptReindexReason);
registerCredentialKind(apiKeyCredentialKind);
registerErrorCode(noteTitleTakenCode);
registerErrorCode(resourceAlreadyExistsCode);

/**
 * The error mappers a fork passes to `PlatformHostCoreModule.forRoot({ errorMappers })`
 * in `platform/host-core.config.ts`. Not passed there by default: see
 * `prisma-unique-violation.mapper.ts`.
 */
export const APP_ERROR_MAPPERS: readonly ErrorMapper[] = [prismaUniqueViolationMapper];
