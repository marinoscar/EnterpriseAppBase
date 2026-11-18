// =============================================================================
// The shell's `<main>` variant (issue #1080)
// =============================================================================
//
// `ShellLayout` pads `<main>` and renders the shell-wide banners above the
// page. A map, a full-screen viewer or a canvas wants neither: it renders edge
// to edge. Such a page asks for it with `useShellMainVariant('full-bleed')`, so
// the layout stays mounted (rail, AppBar and any context pane keep their
// state) and only `<main>`'s treatment changes while the page is mounted.
//
// NOT A BREAKPOINT GATE. The variant drops `<main>`'s horizontal and top
// padding and the banners slot; gate 3 (`pb: { xs: 10, sm: 3 }`, the clearance
// of the fixed bottom bar) is applied in both variants, so a full-bleed page
// on a phone still clears the bottom bar.
// =============================================================================

import { createContext, useContext, useEffect } from 'react';

/**
 * How `ShellLayout` draws `<main>`: `'padded'` (the default: padding on every
 * side and the `banners` slot above the page) or `'full-bleed'` (no horizontal
 * or top padding and no banners; the bottom-bar clearance below `sm` stays).
 *
 * @stability experimental
 */
export type ShellMainVariant = 'padded' | 'full-bleed';

/**
 * The setter `ShellLayout` provides to the pages it renders. `null` clears a
 * page's request, falling back to the layout's `mainVariant` prop.
 *
 * @internal
 */
export type ShellMainVariantSetter = (variant: ShellMainVariant | null) => void;

/**
 * Carries {@link ShellMainVariantSetter} from `ShellLayout` to the page.
 * Absent (a page rendered outside the shell, a test) means the hook is a no-op.
 *
 * @internal
 */
export const ShellMainVariantContext = createContext<ShellMainVariantSetter | null>(null);

/**
 * Asks the enclosing `ShellLayout` to draw `<main>` as `variant` while the
 * calling component is mounted, and resets it on unmount. The shell is not
 * remounted, so the rail, the AppBar and any context pane keep their state
 * across the route change. Outside a `ShellLayout` it does nothing.
 *
 * A page's request wins over the layout's `mainVariant` prop. Call it from the
 * page component (one caller at a time; the last mounted one wins).
 *
 * @param variant - the treatment this page wants.
 *
 * @example
 * ```tsx
 * function MapPage() {
 *   useShellMainVariant('full-bleed');
 *   return <MapCanvas />;
 * }
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useShellMainVariant(variant: ShellMainVariant): void {
  const setVariant = useContext(ShellMainVariantContext);
  useEffect(() => {
    if (setVariant === null) return undefined;
    setVariant(variant);
    return () => setVariant(null);
  }, [setVariant, variant]);
}
