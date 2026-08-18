/**
 * Patches react-transition-group's package.json to add an `exports` map.
 *
 * WHY THIS IS NEEDED:
 * react-transition-group v4.x ships without a package `exports` field.  When
 * MUI v9's ESM entry files (*.mjs) run under Node's native ESM loader they
 * import bare subpath specifiers such as
 *   import TransitionGroupContext from 'react-transition-group/TransitionGroupContext'
 * Node's native ESM resolver treats these as directory imports, which are
 * forbidden in ESM and throw:
 *   "Directory import … is not supported resolving ES modules"
 *
 * The fix: inject a minimal `exports` map that resolves every known subpath to
 * the package's CJS file.  CJS is preferred here (over ESM) to guarantee a
 * single React instance in the Vitest jsdom test environment.
 *
 * NOTE — the map MUST also expose the explicit `./cjs/*` form.  Adding an
 * `exports` field is subtractive: before the patch every path in the package
 * was reachable, and afterwards ONLY the listed ones are.  MUI changed its
 * specifier from `react-transition-group/TransitionGroupContext` to the fully
 * qualified `react-transition-group/cjs/TransitionGroupContext.js` (seen in
 * @mui/material 9.3.x), so a map listing only the bare subpaths turns this
 * patch from the fix into the cause:
 *   "Package subpath './cjs/TransitionGroupContext.js' is not defined by
 *    exports"
 * Both spellings are therefore listed, and any future one should be added
 * here rather than by removing the map.
 *
 * This script is idempotent, and also self-UPGRADING: it rewrites whenever the
 * installed map differs from the expected one, so bumping the list above is
 * enough to re-patch an already-patched install.  A plain
 * `if (pkg.exports) return` would silently leave a stale map in place, which
 * is exactly how the bug above survives an `npm install`.
 */

const fs = require('fs');
const path = require('path');

const pkgPath = path.join(
  __dirname,
  '../node_modules/react-transition-group/package.json',
);

if (!fs.existsSync(pkgPath)) {
  // Package not installed (e.g. CI workspace filtered install) – nothing to do.
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const subpaths = [
  'CSSTransition',
  'ReplaceTransition',
  'SwitchTransition',
  'Transition',
  'TransitionGroup',
  'TransitionGroupContext',
  'config',
];

const expected = {
  '.': { require: './cjs/index.js', default: './cjs/index.js' },
};
for (const s of subpaths) {
  // Bare form, e.g. 'react-transition-group/TransitionGroupContext'.
  expected[`./${s}`] = {
    require: `./cjs/${s}.js`,
    default: `./cjs/${s}.js`,
  };
}
// Fully qualified form, e.g.
// 'react-transition-group/cjs/TransitionGroupContext.js' (@mui/material 9.3+).
expected['./cjs/*'] = './cjs/*';
// package.json is conventionally resolvable and costs nothing to allow.
expected['./package.json'] = './package.json';

if (JSON.stringify(pkg.exports) === JSON.stringify(expected)) {
  // Already patched with the current map – nothing to do.
  process.exit(0);
}

pkg.exports = expected;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('react-transition-group exports patched successfully.');
