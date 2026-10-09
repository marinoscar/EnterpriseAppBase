/**
 * The packaged DataTable conformance suite
 * (`@marinoscar/platform-web/datatable/testing`) against the built-in fixture,
 * rendered under the app's own light and dark themes, so the axe passes cover
 * the app's palette and not only MUI's defaults.
 */

import { describe } from 'vitest';
import { runDataTableConformanceSuite } from '@marinoscar/platform-web/datatable/testing';
import { darkTheme, lightTheme } from '../../../theme';

describe('DataTable — shared conformance suite, app themes', () => {
  runDataTableConformanceSuite({ themes: { light: lightTheme, dark: darkTheme } });
});
