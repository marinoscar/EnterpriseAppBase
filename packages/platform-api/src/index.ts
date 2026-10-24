/**
 * The npm name of this package, which holds NestJS dynamic modules of the platform.
 *
 * A placeholder export so the build, the pack check and the smoke imports in
 * CI have something to load end to end. Real slices arrive as subpath
 * exports (`@marinoscar/platform-api/<slice>`).
 *
 * @stability experimental
 */
export const PLATFORM_PACKAGE = '@marinoscar/platform-api' as const;
