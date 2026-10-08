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
