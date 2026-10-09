// The app's identity, read from identity.json (the single identity source).
// `scripts/rename.mjs` rewrites identity.json and the few literal targets no
// runtime read can reach; everything else derives from these exports.
const identity = require('./identity.json');

/** Lowercase, hyphenated, never empty: the rule `scripts/rename.mjs` uses too. */
function slugify(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'app';
}

exports.APP_NAME = identity.productName;
exports.APP_TAGLINE = identity.tagline;
exports.APP_SLUG = slugify(identity.productName);
exports.REPO_SLUG = identity.repoSlug;
exports.REPO_URL = `https://github.com/${identity.repoSlug}`;
exports.THEME_COLOR = identity.themeColor;
exports.BACKGROUND_COLOR = identity.backgroundColor;
exports.CLI_NAME = identity.cliName;

/**
 * The fields the Android companion's identity derives from: the product name,
 * the repository slug and the optional `android` block of `identity.json`
 * (`{ applicationId?, deepLinkScheme?, storagePrefix?, apkStem? }`), frozen.
 * Pass it to `androidIdentity()` of `@marinoscar/platform-contract/android-app`.
 */
exports.ANDROID_IDENTITY_SOURCE = Object.freeze({
  productName: identity.productName,
  repoSlug: identity.repoSlug,
  ...(identity.android ? { android: Object.freeze({ ...identity.android }) } : {}),
});

// The optional platform slices this app mounts, from slices.json (the slice manifest).
// The API and the web app validate the ids against their own slice definitions.
const slices = require('./slices.json');

/** The ids in `slices.json` `enabled`, in file order. */
exports.ENABLED_SLICES = Object.freeze([...slices.enabled]);
