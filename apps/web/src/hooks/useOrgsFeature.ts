/**
 * Whether ORGANIZATION management exists in this deployment (#726, PP-6.7):
 * true iff `GET /api/auth/me` reports `tenancyMode: 'multi'`. Packaged
 * (#727, PP-6.6) in `@marinoscar/platform-web/identity/headless`; a
 * compatibility re-export until the imports point at the package directly.
 */
export { useOrgsFeature } from '@marinoscar/platform-web/identity/headless';
