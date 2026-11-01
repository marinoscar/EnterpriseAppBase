/**
 * The npm name of this package, which holds Zod DTOs and types shared by the platform API and web packages.
 *
 * The root entry exports only this name, so the smoke imports in CI have
 * something to load end to end. Every slice is a subpath export
 * (`@marinoscar/platform-contract/<slice>`, the first being `./doctor`) and is
 * deliberately not re-exported here: a consumer loads only the slices it
 * imports, and importing the root never loads zod.
 *
 * @stability experimental
 */
export const PLATFORM_PACKAGE = '@marinoscar/platform-contract' as const;
