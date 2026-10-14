// =============================================================================
// The credential purpose manifest (issue #735)
// =============================================================================
//
// The one grep-able list of every system and org credential purpose this
// application stores, and of every kind of key its users may bring, for the
// two registries of `@marinoscar/platform-api/credentials`. Platform purposes
// first, each declared beside its constant in the slice that owns it (until
// that slice is extracted into the package and registers its own); the app's
// own (`app-registrations/credentials.ts`) last, so a collision names the app.
//
// Imported for its side effect by `credentials.config.ts`, at import time and
// before the application bootstraps (the registries freeze then). The stores
// refuse a write to a purpose that is not listed here.
// =============================================================================

import { registerCredentialPurpose, registerUserCredentialPurpose } from '@marinoscar/platform-api/credentials';
import { TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE } from '@marinoscar/platform-api/telemetry';

import { AI_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/ai';
import { APP_CREDENTIAL_PURPOSES, APP_USER_CREDENTIAL_PURPOSES } from '../../app-registrations/credentials';
import { SES_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/email';
import { SMTP_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/email';
import { PUSH_VAPID_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/notifications';
import { STORAGE_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/storage';

registerCredentialPurpose(AI_CREDENTIAL_PURPOSE_DEF);
registerCredentialPurpose(STORAGE_CREDENTIAL_PURPOSE_DEF);
registerCredentialPurpose(SMTP_CREDENTIAL_PURPOSE_DEF);
registerCredentialPurpose(SES_CREDENTIAL_PURPOSE_DEF);
registerCredentialPurpose(PUSH_VAPID_CREDENTIAL_PURPOSE_DEF);
// The telemetry slice is packaged but sits beside credentials in the slice
// graph (it reaches the store through its TELEMETRY_CREDENTIAL_STORE port), so
// the app declares its purpose for it.
registerCredentialPurpose({
  purpose: TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE,
  owner: 'telemetry',
  label: 'GreptimeDB reader and admin passwords',
  tiers: ['system'],
});

for (const def of APP_CREDENTIAL_PURPOSES) registerCredentialPurpose(def);
for (const def of APP_USER_CREDENTIAL_PURPOSES) registerUserCredentialPurpose(def);
