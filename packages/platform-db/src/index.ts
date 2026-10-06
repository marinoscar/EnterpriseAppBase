/**
 * The npm name of this package, which holds Prisma schema fragments, SQL migrations and seed functions of the platform.
 *
 * A placeholder export so the build, the pack check and the smoke imports in
 * CI have something to load end to end. Real slices arrive as subpath
 * exports (`@marinoscar/platform-db/<slice>`).
 *
 * @stability experimental
 */
export const PLATFORM_PACKAGE = '@marinoscar/platform-db' as const;

export * from './compose/index.js';
export * from './lock/index.js';
export * from './sync/index.js';
