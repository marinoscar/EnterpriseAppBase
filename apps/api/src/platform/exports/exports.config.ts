// =============================================================================
// The app's binding of the exports slice (issue #744, PP-9.2)
// =============================================================================
//
// `@marinoscar/platform-api/exports`, configured for this app: the generated
// client's datamodel (the platform sources derive each registered model's
// columns from it), the product slug for download names, the host ports
// `ExportsHostModule` binds, and EvoPath's defaults for everything else
// (7-day retention, 5-minute download URLs, 3 exports in flight per subject).
// Imported once by `app.module.ts`.
// =============================================================================

import './export-registrations.manifest';

import { ExportsModule } from '@marinoscar/platform-api/exports';
import { Prisma } from '@prisma/client';
import { APP_SLUG } from '@app/shared';

import { ExportsHostModule } from './exports-host.module';

export const exportsModule = ExportsModule.forRoot({
  datamodel: Prisma.dmmf.datamodel,
  appSlug: APP_SLUG,
  imports: [ExportsHostModule],
});
