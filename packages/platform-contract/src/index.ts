/**
 * The npm name of this package, which holds Zod DTOs and types shared by the platform API and web packages.
 *
 * A placeholder export so the build, the pack check and the smoke imports in
 * CI have something to load end to end. Real slices arrive as subpath
 * exports (`@marinoscar/platform-contract/<slice>`).
 *
 * @stability experimental
 */
export const PLATFORM_PACKAGE = '@marinoscar/platform-contract' as const;
