// =============================================================================
// The screens the TUI can show  (issue #145, epic #110; PP-8.9 #715)
// =============================================================================
//
// A route is a string id since #715: the platform's screens and an app's are
// registered (screen-registry.ts), not listed in a closed union. `menu` is
// the router's own home and never a registered screen.
//
// There is deliberately no history stack. Every screen returns to the menu and
// nowhere else, so "back" has exactly one meaning on every screen, which is
// what lets Esc be bound to it globally without a user ever having to work out
// where they will land.
// =============================================================================

/** `menu`, or the route id of a built-in or registered screen. */
export type Route = string;

/** The router's home. */
export const MENU_ROUTE = 'menu';
