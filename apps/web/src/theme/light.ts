import type { PaletteOptions } from '@mui/material/styles';
import { THEME_COLOR } from '@app/shared';
import { shellPalette } from '@marinoscar/platform-web/shell/headless';

/**
 * The light palette `lightTheme` is built from: the packaged shell's (#868)
 * with this app's brand colour as `primary.main` (issue #216; see
 * `theme/index.ts`).
 */
export const lightPalette: PaletteOptions = shellPalette('light', { primary: { main: THEME_COLOR } });
