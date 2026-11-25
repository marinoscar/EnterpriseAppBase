// =============================================================================
// Whether the active destination's context pane is drawn (issue #1109)
// =============================================================================
//
// `ShellNavigationRail` draws a destination's `contextPane` only beside the
// EXPANDED library rail: at `lg` and up, with the rail not collapsed, outside
// Console mode. A page sometimes needs to know which: a hub that redirects to
// its first item when the pane lists the items, but must stay put when the
// pane is not drawn (a collapsed rail, the medium tier, a phone), because the
// hub is then the only way to reach those items.
//
// NOT A BREAKPOINT GATE, and no new media query. The rail REPORTS the pane it
// actually drew (the destination's key, or `null`) through a context
// `ShellLayout` provides; the hook reads that report. The answer therefore
// follows the rail's own `expanded` decision exactly and can never disagree
// with what is on screen. The report is posted from an effect, so the first
// render reads `false` and the next one the real value.
// =============================================================================

import { createContext, useContext, useEffect } from 'react';

/**
 * What `ShellLayout` provides: the key of the destination whose pane is drawn
 * (or `null`), and the setter the rail reports through.
 *
 * @internal
 */
export interface ShellContextPaneState {
  /** The key of the destination whose context pane is drawn, or `null`. */
  visibleKey: string | null;
  /** Called by the rail with the pane it draws (`null` for none). */
  report: (key: string | null) => void;
}

/**
 * Carries {@link ShellContextPaneState} from `ShellLayout`. Absent (a page
 * rendered outside the shell, a test) means no pane is ever reported.
 *
 * @internal
 */
export const ShellContextPaneContext = createContext<ShellContextPaneState | null>(null);

/**
 * Reports the pane the calling rail draws, and clears the report on unmount
 * (the rail unmounts below `sm`). A no-op outside `ShellLayout`.
 *
 * @param key - the destination whose pane is drawn, or `null` for none.
 *
 * @internal
 */
export function useReportShellContextPane(key: string | null): void {
  const state = useContext(ShellContextPaneContext);
  const report = state?.report;
  useEffect(() => {
    if (report === undefined) return undefined;
    report(key);
    return () => report(null);
  }, [report, key]);
}

/**
 * Whether a destination's context pane is currently drawn beside the rail.
 * With no argument: whether ANY pane is drawn. With a destination key: whether
 * THAT destination's pane is the one drawn.
 *
 * It reads what the packaged `ShellNavigationRail` reports, so it is `false`
 * outside a `ShellLayout`, on the first render (the report is an effect), and
 * when the app replaces the rail with its own.
 *
 * @param destinationKey - a destination's `key`; omit for "any pane".
 * @returns `true` while the pane is drawn.
 *
 * @example
 * ```tsx
 * function LibraryHub() {
 *   const paneVisible = useShellContextPaneVisible('library');
 *   // The pane lists the items: go straight to the first. Without it, this
 *   // hub is the only way in, so stay.
 *   if (paneVisible && items[0]) return <Navigate to={items[0].path} replace />;
 *   return <ItemList items={items} />;
 * }
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useShellContextPaneVisible(destinationKey?: string): boolean {
  const state = useContext(ShellContextPaneContext);
  if (state === null || state.visibleKey === null) return false;
  return destinationKey === undefined || state.visibleKey === destinationKey;
}
