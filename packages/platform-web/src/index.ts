/**
 * The npm name of this package, which holds React pages, components and hooks of the platform.
 *
 * A placeholder export so the build, the pack check and the smoke imports in
 * CI have something to load end to end. Real slices arrive as subpath
 * exports (`@marinoscar/platform-web/<slice>`).
 *
 * @stability experimental
 */
export const PLATFORM_PACKAGE = '@marinoscar/platform-web' as const;
