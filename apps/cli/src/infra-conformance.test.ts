import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runInfraConformance } from '@marinoscar/platform-infra/testing';
import { describe, expect, it } from 'vitest';

// =============================================================================
// The platform's infra conformance, over THIS app  (PP-14.22)
// =============================================================================
//
// `platform-infra sync --check` proves the generated files are the package's;
// this proves the app's own files WORK: `docker compose config` over every
// mode with the app's `infra/compose/app.*.compose.yml` overlays, and
// `nginx -t` over `infra/nginx/app.d/` with both CSP files. Docker and nginx
// are tools: when one is missing the case is a passing case NAMED with the
// reason (CI has both), so a missing tool is visible, never a silent green.
// =============================================================================

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

runInfraConformance({ appRoot: REPO, testApi: { describe, it, expect } });
