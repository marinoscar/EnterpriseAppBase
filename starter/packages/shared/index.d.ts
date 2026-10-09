/** The product's display name (`identity.json` `productName`). */
export declare const APP_NAME: string;
/** One-line description (`identity.json` `tagline`). */
export declare const APP_TAGLINE: string;
/** `APP_NAME` slugified: lowercase, hyphenated, never empty. */
export declare const APP_SLUG: string;
/** `owner/name` of the app's GitHub repository. */
export declare const REPO_SLUG: string;
/** `https://github.com/<REPO_SLUG>`. */
export declare const REPO_URL: string;
/** Brand primary colour, `#rrggbb`. */
export declare const THEME_COLOR: string;
/** First-paint background colour, `#rrggbb`. */
export declare const BACKGROUND_COLOR: string;
/** The CLI binary name; seeds its config directory and `<NAME>_` environment prefix. */
export declare const CLI_NAME: string;
/**
 * The fields the Android companion's identity derives from: the product name, the
 * repository slug and the optional `android` block of `identity.json` (each field
 * overrides one derived default).
 */
export declare const ANDROID_IDENTITY_SOURCE: {
  readonly productName: string;
  readonly repoSlug: string;
  readonly android?: {
    readonly applicationId?: string;
    readonly deepLinkScheme?: string;
    readonly storagePrefix?: string;
    readonly apkStem?: string;
  };
};
/** The optional platform slices this app mounts: the ids in `slices.json` `enabled`, in file order. */
export declare const ENABLED_SLICES: readonly string[];
