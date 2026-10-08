/**
 * Route guard: render `children` only in a multi-organization deployment
 * (#726, PP-6.7). Packaged (#727, PP-6.6) in
 * `@marinoscar/platform-web/identity/headless`; a compatibility re-export
 * until the imports point at the package directly (PP-6.6 part 5).
 */
export { RequireMultiOrg } from '@marinoscar/platform-web/identity/headless';
