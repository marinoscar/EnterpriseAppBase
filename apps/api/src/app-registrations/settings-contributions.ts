// =============================================================================
// Packages that contribute settings (PP-14.21)
// =============================================================================
//
// A separately installed package can contribute settings namespaces, and
// extensions of existing ones, without this app listing them by hand: the
// package calls `registerSettingsContribution({ id, system, user, extensions })`
// from its entry module, and the app imports the package FOR ITS SIDE EFFECT
// here. The manifests (`settings/registry/*.manifest.ts`) import this file
// first, then assemble in this order: the platform's namespaces, the
// contributions' in the order they are imported below, the app's own
// (`settings.ts`); extensions fold in the same order; a key two of them declare
// fails at import time naming both.
//
// Upstream keeps this file empty forever. A fork adds its imports:
//
//   import '@kappa/billing-settings';
//
// The worked example, a contribution written the way a package would write it,
// is `platform-extensions/settings/contribution.ts`; it is not imported here, so
// the reference app's settings document is unchanged. The test
// `test/examples/settings/contribution.spec.ts` imports it exactly as this
// file would.
// =============================================================================

export {};
