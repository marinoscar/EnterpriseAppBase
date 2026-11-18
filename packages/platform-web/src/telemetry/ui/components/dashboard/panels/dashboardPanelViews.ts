/**
 * The dashboard-panel view registry (PP-14.18).
 *
 * A dashboard panel has two halves, joined by its id: the API registers
 * `registerDashboardPanel({ id, label, order, data })` and serves the panel's
 * payload at `GET …/dashboard/panels/:id`; the web registers the VIEW that draws
 * that payload, here, with `registerDashboardPanelView(id, View)`. The platform's
 * own `api` and `logs` panels are views registered through the same function
 * (`registerPlatformDashboardPanelViews`), which draw their own frame and read
 * their own data.
 *
 * The dashboard draws, in `order`, the app's panels the API lists that have a
 * view registered here; a listed panel with no view is skipped, a view whose
 * panel the API does not list is never drawn.
 *
 * Register at import time, from a file the app's entry loads (the registry is a
 * module-level map: the app's registration and the dashboard page share one
 * instance because they import this one module).
 */
import type { ComponentType } from 'react';
import { DASHBOARD_PANEL_ID_PATTERN } from '@marinoscar/platform-contract/telemetry';

import type { DashboardState } from '../../../../headless/lib/dashboardState.js';
import type { AssistantPanelContext } from '../../../../headless/lib/dashboard/assistantPrompt.js';
import type { DashboardPanelMeta, DashboardQuery } from '../../../../headless/services/telemetryDashboard.js';
import type { DashboardLayout } from '../DashboardFilterBar.js';
import type { PanelAction } from '../DashboardPanel.js';

/**
 * What the dashboard page offers a panel view: the page's own state and the
 * header actions it gives every panel ("Ask assistant", "Open in Explorer").
 * Read-only data and callbacks; no API client.
 *
 * @stability experimental
 */
export interface DashboardPanelHost {
  /** The dashboard's URL state: range, filters, severities, refresh. */
  readonly state: DashboardState;
  /** Changes the dashboard's URL state (zoom to a window, change the severities). */
  update(patch: Partial<DashboardState>): void;
  /**
   * The header actions the page gives a panel: "Ask assistant" (when the
   * assistant is available) and "Open in Explorer" with the panel's `sql`.
   *
   * @param panelId - the panel's DOM test id (`panel-signups`).
   * @param sql - the statement(s) the panel ran, primary first.
   * @param context - what "Ask assistant" describes, or `null`.
   * @internal Used by the platform's own panels; a view that wants the frame's actions returns a `sql` in its payload instead.
   */
  actionsFor(panelId: string, sql: string | string[] | undefined, context: AssistantPanelContext | null): PanelAction[];
  /**
   * A chart-zoom handler: the window the buckets from `first` to `last` span
   * becomes the dashboard's window.
   *
   * @param starts - the buckets' start instants.
   * @param bucketSeconds - the bucket size.
   */
  zoomTo(starts: string[], bucketSeconds: number): (first: number, last: number) => void;
}

/**
 * What a panel view receives.
 *
 * @typeParam Payload - the shape the app's API panel returns (agreed between the two).
 *
 * @extensionPoint component
 * @stability experimental
 */
export interface DashboardPanelViewProps<Payload = unknown> {
  /** The panel as the API lists it. */
  panel: DashboardPanelMeta;
  /** The payload the API returned for the dashboard's window (`frame: 'page'`); `undefined` for a view that draws its own frame and reads its own data. */
  payload: Payload;
  /** The window and filters the dashboard asks every panel for (the series query: 30 buckets on a phone). */
  query: DashboardQuery;
  /** The dashboard's refresh counter: a view that fetches for itself refetches when it changes. */
  tick: number;
  /** Phone, tablet or desktop, decided by the page. */
  layout: DashboardLayout;
  /** The window's length in milliseconds. */
  spanMs: number;
  /** The page's state and header actions. */
  host: DashboardPanelHost;
}

/**
 * How a view is registered.
 *
 * @stability experimental
 */
export interface DashboardPanelViewOptions {
  /**
   * Who draws the panel's frame (title, loading skeleton, error with Retry,
   * header actions). `page` (the default): the dashboard does, and the view
   * draws only the payload. `self`: the view draws everything, including its own
   * `DashboardPanel`, and reads its own data (the platform's `api` and `logs`).
   */
  frame?: 'page' | 'self';
}

/**
 * A registered view.
 *
 * @stability experimental
 */
export interface RegisteredDashboardPanelView {
  /** The panel id. */
  readonly id: string;
  /** The component. */
  readonly View: ComponentType<DashboardPanelViewProps<never>>;
  /** Who draws the frame. */
  readonly frame: 'page' | 'self';
  /** Whether the platform registered it (`api`, `logs`). */
  readonly builtin: boolean;
}

const views = new Map<string, RegisteredDashboardPanelView>();

function put(id: string, View: ComponentType<DashboardPanelViewProps<never>>, frame: 'page' | 'self', builtin: boolean): void {
  if (!DASHBOARD_PANEL_ID_PATTERN.test(id)) {
    throw new Error(`Dashboard panel view id "${id}" must match ${DASHBOARD_PANEL_ID_PATTERN}.`);
  }
  if (typeof View !== 'function' && (typeof View !== 'object' || View === null)) {
    throw new Error(`Dashboard panel view "${id}" needs a React component.`);
  }
  const existing = views.get(id);
  if (existing) {
    // The same component again is a no-op (a re-evaluated module); another one is a clash.
    if (existing.View === View && existing.frame === frame) return;
    throw new Error(`A dashboard panel view is already registered for "${id}".`);
  }
  views.set(id, Object.freeze({ id, View, frame, builtin }));
}

/**
 * Registers the view that draws the dashboard panel `id`. The API half is
 * `registerDashboardPanel` (`@marinoscar/platform-api/telemetry`).
 *
 * @typeParam Payload - the shape of the payload the API panel returns.
 * @param id - the panel id (the API registers the same one).
 * @param View - the component; it receives {@link DashboardPanelViewProps}.
 * @param options - who draws the frame.
 * @throws Error when `id` is malformed, or another view is already registered for it.
 *
 * @example
 * ```tsx
 * registerDashboardPanelView<{ total: number }>('signups', ({ payload }) => <Typography>{payload.total} sign-ups</Typography>);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerDashboardPanelView<Payload = unknown>(
  id: string,
  View: ComponentType<DashboardPanelViewProps<Payload>>,
  options: DashboardPanelViewOptions = {},
): void {
  put(id, View as ComponentType<DashboardPanelViewProps<never>>, options.frame ?? 'page', false);
}

/**
 * Registers one of the platform's own panel views. Not part of the public
 * surface (the `ui` index does not export it); the dashboard page calls
 * `registerPlatformDashboardPanelViews`, which uses it.
 */
export function registerPlatformDashboardPanelView(
  id: string,
  View: ComponentType<DashboardPanelViewProps<never>>,
): void {
  put(id, View, 'self', true);
}

/**
 * The view registered for `id`.
 *
 * @param id - a panel id.
 * @returns the registered view, or `undefined`.
 *
 * @stability experimental
 */
export function getDashboardPanelView(id: string): RegisteredDashboardPanelView | undefined {
  return views.get(id);
}

/**
 * Every registered view, in registration order.
 *
 * @returns the views.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function dashboardPanelViews(): RegisteredDashboardPanelView[] {
  return [...views.values()];
}

/** Empties the registry. For tests only: nothing in a running app calls it. */
export function resetDashboardPanelViewsForTests(): void {
  views.clear();
}
