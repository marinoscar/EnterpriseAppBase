// `@marinoscar/platform-api/onboarding/testing`: the onboarding slice's
// conformance suite (issue #745). Importing this entry registers the
// `onboarding` suite with `runPlatformConformance`
// (@marinoscar/platform-api/testing). Never import it from production code.
// Documented in ../README.md.

export { checkOnboardingRegistries, onboardingConformanceSuite, probeOnboardingDerivation } from './conformance';
export type { OnboardingConformanceOptions, OnboardingDerivationProbe } from './conformance';
