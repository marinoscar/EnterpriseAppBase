// =============================================================================
// The packaged-page slot contract (PP-14.23)
// =============================================================================
//
// Every packaged page exported by this package takes ONE optional prop,
// `slots`, whose members are optional components (or, for the table, one
// optional function). A page that is not passed a slot renders exactly the
// markup it always rendered; a slot only ever ADDS to the page or replaces one
// named part of it. The contract is the same on every page, so an app learns it
// once:
//
//   - `PageSlotsBase`: Header, BeforeContent, Sections (top and bottom),
//     AfterContent.
//   - `TableSlots<Row>`: Columns, RowActions, DetailPanel, Toolbar, for a page
//     that draws a table.
//   - page-specific slots, each documented in the page's slice README.
//
// A slot receives DATA (the row, the check, the page's state it already holds),
// never an API client and never a setter into the page's internals. An app that
// needs to call the API from a slot uses its own client or `usePlatformApi()`:
// the permission checks stay on the server.
//
// `test/page-slots.contract.test.ts` enforces it: every exported `*Page`
// component either declares a `slots` prop typed to this contract or is listed,
// with a reason, in `test/page-slots.exempt.json`.
// =============================================================================

import { Fragment, createElement, useMemo } from 'react';
import type { ReactNode } from 'react';

/**
 * A page slot: a function component taking `Props`.
 *
 * Declared with a METHOD signature so the compiler compares its parameter
 * BIVARIANTLY. That is what lets a page hand a slot MORE data than the base
 * contract names (the database backup page's `Sections` also receives the
 * policy and the runs) while the page's `slots` type still extends
 * {@link PageSlotsBase}, and lets an app keep a slot component typed against
 * an older, narrower props shape. Pass a plain function component (a class
 * component is not a slot).
 *
 * @typeParam Props - what the page passes the slot.
 * @stability experimental
 */
export type PageSlot<Props = object> = {
  /** The slot component's call signature (declared as a method so its parameter is compared bivariantly). */
  slot(props: Props): ReactNode;
}['slot'];

/**
 * What a page passes its `Header` slot.
 *
 * `title` and `description` are the page's own words (the same text as its
 * registry card, so the hub card, the rail row, the compact AppBar title and
 * the page `h1` keep naming it identically); a custom header should print the
 * title as the page's `h1`. `readOnly` is true when the viewer lacks the page's
 * write permission (the default header appends " (read-only)"). `actions` is
 * the page's header-level actions: `null` on a page whose default header
 * carries none, which is every packaged operations page (their buttons sit in
 * the body, so a custom header never loses them).
 *
 * @stability experimental
 */
export interface PageHeaderSlotProps {
  /** The page title. A custom header prints it as the page's `h1`. */
  title: ReactNode;
  /** The page subtitle, when the page has one. */
  description?: ReactNode;
  /** The viewer lacks the page's write permission. */
  readOnly?: boolean;
  /** The page's header-level actions, or `null` when its default header has none. */
  actions?: ReactNode;
}

/**
 * What a page passes its `Sections` slot. The slot is rendered twice, once at
 * each end of the page body: return `null` for the position you do not want.
 *
 * @stability experimental
 */
export interface PageSectionsSlotProps {
  /** Where this rendering sits: `'top'` is under the header, `'bottom'` after the page's own content. */
  position: 'top' | 'bottom';
}

/**
 * The slots every packaged page offers. A page's `slots` prop extends this
 * (`interface JobsPageSlots extends PageSlotsBase, TableSlots<Job> { Filters?: ... }`);
 * every member is optional, and an absent slot leaves the page's markup exactly
 * as it was.
 *
 * Order of the body: `Header`, `BeforeContent`, `Sections` (`top`), the page's
 * own content, `Sections` (`bottom`), `AfterContent`. All of it sits inside the
 * page's existing container, so a slot's controls live inside the landmark the
 * page already has.
 *
 * @example
 * ```tsx
 * <JobsPage slots={{ BeforeContent: MaintenanceNotice, Sections: ({ position }) => position === 'bottom' ? <RunbookLinks /> : null }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface PageSlotsBase {
  /** Replaces the page header (title and subtitle). */
  Header?: PageSlot<PageHeaderSlotProps>;
  /** A banner or notice area under the header. */
  BeforeContent?: PageSlot<object>;
  /** Extra sections, rendered at both ends of the body (see {@link PageSectionsSlotProps}). */
  Sections?: PageSlot<PageSectionsSlotProps>;
  /** Content after everything else on the page. */
  AfterContent?: PageSlot<object>;
}

/**
 * The shape the table slots need of a column: what {@link useTableSlotColumns}
 * builds an extra column from. Every table column type of this package (the
 * jobs, nodes and database backup slices' `*TableColumn`, and the datatable
 * slice's `DataTableColumn`) satisfies it.
 *
 * @typeParam Row - the row type.
 * @stability experimental
 */
export interface SlotTableColumn<Row> {
  /** Stable column id. */
  id: string;
  /** Header text. */
  label: string;
  /** Narrow-screen placement. */
  priority: 'primary' | 'secondary' | 'detail';
  /** Cell content. */
  render?: (row: Row) => ReactNode;
}

/**
 * The slots a page that draws a table offers, over the table's `Row`.
 *
 * `RowActions` and `DetailPanel` are drawn as extra columns the page appends
 * (`More actions`, secondary priority; `Details`, detail priority), so they
 * appear in the grid, the tablet expander and the phone card with no new
 * table prop. `Columns` runs last and sees every column, the slots' included.
 *
 * @typeParam Row - the row type.
 * @typeParam Column - the table's column type (a page binds its own).
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface TableSlots<Row, Column extends SlotTableColumn<Row> = SlotTableColumn<Row>> {
  /** Add, reorder or remove columns: receives the page's columns, returns the ones to draw. */
  Columns?: (base: Column[]) => Column[];
  /** Extra per-row actions (buttons, a menu), drawn in an extra `More actions` column. */
  RowActions?: PageSlot<{ row: Row }>;
  /** Extra content in the row's detail view (an extra `Details` column of detail priority). */
  DetailPanel?: PageSlot<{ row: Row }>;
  /** Extra controls above the table. */
  Toolbar?: PageSlot<object>;
}

/**
 * Id of the column {@link useTableSlotColumns} adds for `RowActions`.
 *
 * @stability experimental
 */
export const SLOT_ROW_ACTIONS_COLUMN_ID = 'slot-row-actions';
/**
 * Id of the column {@link useTableSlotColumns} adds for `DetailPanel`.
 *
 * @stability experimental
 */
export const SLOT_DETAIL_PANEL_COLUMN_ID = 'slot-detail-panel';

/**
 * Applies a page's table slots to its columns.
 *
 * With no table slot it returns `columns` itself (the same array), so the
 * table receives exactly what it always did. Otherwise it appends a
 * `RowActions` column and a `DetailPanel` column (in that order), then hands
 * the result to `Columns`.
 *
 * @param columns - the page's own columns (stable identity: the page memoises them).
 * @param slots - the page's table slots, or `undefined`.
 * @returns the columns to draw.
 *
 * @example
 * ```tsx
 * const columns = useTableSlotColumns(baseColumns, slots);
 * ```
 *
 * @stability experimental
 */
export function useTableSlotColumns<Row, Column extends SlotTableColumn<Row>>(
  columns: Column[],
  slots: Pick<TableSlots<Row, Column>, 'Columns' | 'RowActions' | 'DetailPanel'> | undefined,
): Column[] {
  const Columns = slots?.Columns;
  const RowActions = slots?.RowActions;
  const DetailPanel = slots?.DetailPanel;
  return useMemo(() => {
    if (!Columns && !RowActions && !DetailPanel) return columns;
    let next = columns;
    if (RowActions) {
      const column: SlotTableColumn<Row> & { exportable: false; hideable: false } = {
        id: SLOT_ROW_ACTIONS_COLUMN_ID,
        label: 'More actions',
        priority: 'secondary',
        exportable: false,
        hideable: false,
        render: (row) => createElement(RowActions, { row }),
      };
      next = [...next, column as unknown as Column];
    }
    if (DetailPanel) {
      const column: SlotTableColumn<Row> & { exportable: false } = {
        id: SLOT_DETAIL_PANEL_COLUMN_ID,
        label: 'Details',
        priority: 'detail',
        exportable: false,
        render: (row) => createElement(DetailPanel, { row }),
      };
      next = [...next, column as unknown as Column];
    }
    return Columns ? Columns(next) : next;
  }, [columns, Columns, RowActions, DetailPanel]);
}

/**
 * What {@link PageSlotsFrame} takes.
 *
 * @stability experimental
 */
export interface PageSlotsFrameProps {
  /** The page's `slots` prop. Only the members of {@link PageSlotsBase} are read. */
  slots: PageSlotsBase | undefined;
  /** The page's own header, drawn when `slots.Header` is absent. */
  header: ReactNode;
  /** What `slots.Header` receives (the page's title, subtitle and read-only state). */
  headerProps: PageHeaderSlotProps;
  /** The page's own content. */
  children?: ReactNode;
}

/**
 * Lays a page body out in the order the slot contract names: `Header` (or the
 * page's own `header`), `BeforeContent`, `Sections` (`top`), the page's own
 * `children`, `Sections` (`bottom`), `AfterContent`.
 *
 * It renders a fragment: no wrapper element and no style, so a page that passes
 * no slot produces exactly the markup `header` and `children` produce by
 * themselves. A page puts it INSIDE its existing container (the `Container` and
 * the `Box` that pads it), which is why the slots live in the landmark the page
 * already has.
 *
 * @example
 * ```tsx
 * <Container maxWidth="lg">
 *   <PageSlotsFrame slots={slots} header={<MyHeader />} headerProps={{ title: 'My page' }}>
 *     <MyContent />
 *   </PageSlotsFrame>
 * </Container>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function PageSlotsFrame({ slots, header, headerProps, children }: PageSlotsFrameProps): ReactNode {
  const Header = slots?.Header;
  const BeforeContent = slots?.BeforeContent;
  const Sections = slots?.Sections;
  const AfterContent = slots?.AfterContent;
  return createElement(
    Fragment,
    null,
    Header ? createElement(Header, headerProps) : header,
    BeforeContent ? createElement(BeforeContent) : null,
    Sections ? createElement(Sections, { position: 'top' }) : null,
    children,
    Sections ? createElement(Sections, { position: 'bottom' }) : null,
    AfterContent ? createElement(AfterContent) : null,
  );
}
