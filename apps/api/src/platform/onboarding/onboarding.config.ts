// The app's onboarding manifest FIRST: the steps and facts are static
// registries the module reads per request and checks at bootstrap.
import '../../onboarding/onboarding.manifest';

import { OnboardingModule } from '@marinoscar/platform-api/onboarding';

import { OnboardingHostModule } from './onboarding-host.module';

// =============================================================================
// The reference app's onboarding slice (issue #745)
// =============================================================================
//
// One `OnboardingModule.forRoot()`: `GET /api/onboarding` and
// `GET /api/admin/onboarding/metrics` from
// `@marinoscar/platform-api/onboarding`. The admin block and the metrics gate
// on the default `system_settings:read` (the Doctor's, whose report the admin
// steps reuse); the web's Setup guide card declares the same literal.
// =============================================================================

export const onboardingModule = OnboardingModule.forRoot({ imports: [OnboardingHostModule] });
