# DataTable — Shared Column Contract & Renderers

> Issue [#54](https://github.com/marinoscar/EnterpriseAppBase/issues/54), part of epic
> [#51](https://github.com/marinoscar/EnterpriseAppBase/issues/51). Implemented in
> `apps/web/src/components/datatable/`.

One column contract, two renderers, three container-driven layouts. This document is the
`docs/specs/datatable.md` that eight files under `apps/web/src/components/datatable/` already
cite in their own comments.

## A note on issue numbers in this component's source

`DataTable` was ported wholesale from an existing implementation, along with its design
rationale. Comments throughout the component cite issues in the `#237`–`#261` range — `#252`
the foundation and column contract, `#253` the mobile/tablet layouts, `#254` filtering,
`#255` visibility/density/persistence, `#256` virtualization and export, `#257`
accessibility, `#243` the "invisible but tappable" touch-target bug, `#258` the job-queue
pilot migration, `#259`/`#260`/`#261` later migrations in the origin codebase, `#438` a later
fix. **Every one of those numbers belongs to the origin project's tracker, not this one** —
they are retained because they make the comments a coherent decision record on their own,
and because that project's own `docs/specs/datatable.md` indexes by them.

In **this** repo the port is issue #54, epic #51 (also referenced in code as "epic #238",
which is the origin project's epic number for the same port — an artifact of the same
wholesale-port comments, not a second local issue). Nothing in this document, or in the
component's comments, refers to a local issue of the numbers above. See
`apps/web/src/components/datatable/index.ts` for the same note in the code itself.

---

## 1. Why this exists

Before this port, every list in the web app was hand-rolled: `UserList` (270 lines),
`AllowlistTable` (205 lines) and `PersonalAccessTokens` (191 lines) each reimplemented the
same six things — header row, cell formatting, pagination footer, loading spinner, empty
state, row-action menu — with slightly different behavior and no shared contract.
`UserList` and `AllowlistTable` additionally wrapped their table in
`<Paper sx={{ overflow: 'hidden' }}>`, so on a narrow viewport their six-column tables were
**clipped rather than scrollable** — the data was simply unreachable. There was no card or
stacked layout at any width, no column-hiding story, no priority metadata, and
`useMediaQuery` was never used for layout anywhere in the app.

### Scope of this document, as of this port

This document describes the `DataTable` component **as shipped** by issue #54: the contract,
the three layouts, filtering, persistence, virtualization, export, and the accessibility
suite. It does **not** describe any consuming page, because **none exists yet**. Migrating
`UserList`, `AllowlistTable`, `PersonalAccessTokens` and a fourth table onto `DataTable` was
scoped out of #54 into a separate follow-up,
[#67](https://github.com/marinoscar/EnterpriseAppBase/issues/67), specifically so the
component itself could land as one reviewable, well-tested unit rather than being bundled
with four page rewrites. Every example column/row type below is therefore drawn from the
component's own type contract and test fixtures, not from a real page in this repo — when
#67 lands, this document should gain a worked example against this repo's own tables, the
way the origin project's version has one against its own.

---

## 2. File layout

```
apps/web/src/components/datatable/
├── types.ts                    # the column & props contract — the public API
├── DataTable.tsx                # the layout-switch shell
├── useContainerLayout.ts        # container measurement + layout resolution
├── index.ts                     # public export surface
├── BulkActionBar.tsx            # shared selection UI (both renderers)
├── desktop/
│   ├── DesktopGridRenderer.tsx  # MUI X DataGrid — serves BOTH desktop and tablet
│   ├── columnAdapter.ts         # DataTableColumn -> GridColDef mapping
│   ├── cells.tsx                # empty/loading overlays, TruncatedCell
│   ├── detailRow.tsx            # tablet row-expansion (synthetic rows + colSpan)
│   └── RowActionsCell.tsx       # per-row action button/menu
├── mobile/
│   ├── CardListRenderer.tsx     # the phone renderer
│   ├── DataCard.tsx             # one row, as a card
│   ├── CardField.tsx            # label/value pair, incl. tap-to-expand truncation
│   ├── CardSortControl.tsx      # sort UI (a card has no clickable header)
│   └── CompactPagination.tsx    # prev/range/next — TablePagination is too wide
├── filter/
│   ├── filterModel.ts           # pure functions over the normalized filter model
│   ├── operators.ts             # the operator catalog, per filterType
│   ├── filterUrl.ts             # URL <-> filter model serialization (opt-in helper)
│   ├── DataTableFilterBar.tsx   # the filter surface — shape differs per layout
│   ├── FilterEditor.tsx, FilterChips.tsx, QuickSearchField.tsx
├── layout/
│   ├── layoutModel.ts           # pure persistence/resolution logic
│   ├── useDataTableLayoutPrefs.ts  # state + debounced writes
│   └── DataTableViewBar.tsx     # column visibility + density surface
├── virtualization/
│   ├── gridVirtualization.ts    # when the grid trades auto-height for a bounded viewport
│   └── cardVirtualization.ts    # render-skipping for the card list (NOT a virtualizer)
├── export/
│   ├── csv.ts                   # pure CSV serialization (RFC 4180 + formula-injection guard)
│   ├── exportModel.ts           # column selection, "all matching rows", filenames
│   └── DataTableExportControl.tsx
├── shared/
│   ├── IndeterminateCheckbox.tsx
│   └── rowActionConfirm.tsx     # one confirm dialog per table, not one per row
└── __tests__/
    ├── conformance/runDataTableConformanceSuite.tsx  # the shared a11y/behavior battery
    └── testUtils/                                    # jsdom layout stubs, a11y guards, contrast checker
```

Consumers should import from `components/datatable` (`index.ts`) only — `desktop/`,
`mobile/`, `filter/`, `layout/`, `virtualization/`, `export/` and `shared/` are
implementation detail, re-exported deliberately rather than reached into directly.

---

## 3. The `priority` pivot

`DataTableColumnPriority = 'primary' | 'secondary' | 'detail'` is the single field that
drives all three layouts from one column declaration:

- **`primary`** — the desktop/tablet grid's always-visible lead columns; the card's headline.
- **`secondary`** — a visible grid column; the card's body, as stacked label/value pairs.
- **`detail`** — hidden by default on the tablet grid (reachable through row expansion, §9);
  the card's collapsed "More details" region, closed by default.

A column author never writes "hide this below 1200px" or "show this only on mobile." They
state how important the column is, once, and each renderer decides what that means for its
own layout. A `detail` column is never *lost*, only *folded* — into a tablet row expander or
a collapsed card region — because hiding a column with no route back to it would be data loss
dressed up as responsive design.

---

## 4. `DataTableColumn<Row>`

Defined in `types.ts`. `render` and `value` are intentionally separate concerns: `render`
produces the *visual* cell (chips, links, avatars); `value` produces the *scalar* behind it —
the thing sorting, filtering, and CSV export operate on. A column with only `value` renders
that value as text (via `formatColumnValue`, which turns `null`/`''` into an em dash — `—`,
never written into a CSV, see §13). A column with only `render` has no scalar and therefore
cannot be sorted or exported meaningfully.

| Field | Default | Notes |
| --- | --- | --- |
| `id` | required | Stable, unique. Doubles as the DataGrid `field` and the sort field sent to the server. |
| `label` | required | Header text (desktop) / field label (card). |
| `render?: (row) => ReactNode` | — | Falls back to the formatted `value` scalar. |
| `value?: (row) => string \| number \| null` | `row[id]` if present, else `null` | Source of truth for sort/filter/export. |
| `align` | `'left'` | Cell + header alignment. **Grid-only** — a card never honours it (§8.1). |
| `priority` | required | §3. |
| `sortable` | **`false`** | See below. |
| `filterable` | **`false`** | `true` or an explicit `FilterOperator[]` pinning the offered set. See below. |
| `filterType` | `'text'` | `'text' \| 'number' \| 'date' \| 'enum' \| 'boolean'`. Decides the operator set and the operand control. |
| `enumValues` | — | Required for `filterType: 'enum'`; an enum column with none is treated as not filterable. |
| `filterOnly` | `false` | A query parameter with no cell (§10.4). Ignored: `priority`, `align`, `truncate`, sizing hints. |
| `searchable` | `false` | Declarative only — documents which columns quick search covers; the table never searches rows itself. |
| `exportable` | `true` | `false` keeps a column out of CSV entirely, e.g. secret material. |
| `hideable` | `true` | `false` pins the column permanently visible and out of the column picker. |
| `truncate` | — | Clips to an ellipsis + tooltip on the grid; clips to two lines + tap-to-expand on a card. |
| `width` / `minWidth` / `flex` | — | Desktop sizing hints; `width` and `flex` are mutually exclusive. |

### `sortable` and `filterable` default to `false` — deliberately against DataGrid's own default

Both are **always server-side**: enabling `sortable` only makes the grid header interactive,
and the owning page must handle `sort.onSortChange` and refetch; the table never sorts `rows`
itself. `filterable` works the same way, and DataGrid's own client-side filtering is **hard-
disabled** in `columnAdapter.ts` (`filterable: false` is set unconditionally on every
`GridColDef`) — turning it on would filter only the rows already loaded on the current server
page, which is *worse than no filter at all*, because the user believes the wrong answer:
a client-side filter over a server-paginated page looks like it searched everything and
quietly only searched the twenty-five rows in memory.

Both are opt-in (rather than opt-out, DataGrid's own posture) for the same underlying reason:
a sortable header or a filter control that the owning page has not wired up to a refetch
*looks live and does nothing* — the worst possible affordance, because it invites the user to
trust a control that silently ignores them.

### `filterOnly` — a query parameter with no cell

Discovered by the #258 pilot migration (origin numbering, §"A note on issue numbers" above).
A real endpoint's query parameters are not always a subset of its response's fields. In this
repo, `GET /api/allowlist` accepts `status=pending|claimed`, which is a nullness predicate
over `claimedById` (`allowlist.service.ts`) — not a field any row carries — and
`GET /api/users` accepts `role`, a filter over a relation rather than a scalar. Both are
first-class, documented query parameters; neither has a scalar worth printing once per row.
Before this flag, the only ways to express them were a bespoke control beside the table
(exactly what the shared filter bar exists to delete) or a decorative column whose cells say
nothing useful on every row. A `filterOnly` column contributes to the filter surface and to
nothing else — never a grid column, never a card field, never in the column picker, never in
a CSV export.

---

## 5. `DataTableProps<Row>`

Also `types.ts`. Selection, pagination, sort, filters and quick search are all **controlled**
— owned by the calling page, handed to the table as props, and reported back out via
callbacks. The table never mutates `rows` on its own behalf. This is what makes a layout
switch (§7) lossless: nothing a user chose lives inside a renderer, so a resize swaps the
tree without losing a selected id, the current page, the active sort, or an applied filter.

Key props, beyond `columns` / `rows` / `rowId`:

- **`pagination?: DataTablePaginationConfig`** — `page` is **zero-based** (matching MUI);
  this repo's APIs are one-based, so a calling page converts at its own fetch boundary
  (`page: pagination.page + 1`). `total` comes from the server's count.
- **`sort?: DataTableSortConfig`** — `sort: DataTableSortState | null`, `null` meaning "server
  default order," plus `onSortChange`.
- **`selection?: DataTableSelectionConfig`** — a `Set<string>` of row ids.
  **Selection is page-scoped**: because pagination is server-side, the table only ever knows
  about ids it has loaded, so "select all" means "select every row on this page," never
  every row matching the query.
- **`filters?`/`onFiltersChange?`** — the normalized `DataTableFilterModel` (§10).
- **`quickSearch?: DataTableQuickSearchConfig`** — controlled, debounced global search (§10.4).
- **`rowActions?`/`bulkActions?`** — per-row and per-selection actions, each optionally
  `confirm`-gated through one shared dialog per table (`shared/rowActionConfirm.tsx`), not
  one dialog instantiated per row.
- **`csvExport?: DataTableExportConfig<Row>`** / **`disableExport?`** — §13.
- **`tableId?: string`** — opts into per-user persistence of visibility/density/sort/page
  size under `user_settings.dataTables[tableId]` (§11). Omitting it keeps every control
  working, session-scoped only. Chosen by the page, never derived from a route or label,
  because it *is* the storage key and must survive a rename.
- **`density?`** — the page's *default*; a user's own persisted choice overrides it.
- **`renderer?: DataTableRendererMode`** (`'auto' | 'desktop' | 'tablet' | 'mobile'`, default
  `'auto'`) and **`mobileBreakpoint?` / `tabletBreakpoint?`** — per-instance overrides of the
  container breakpoints (§7), for a host that knows something the table cannot measure (a
  chrome-heavy panel, unusually wide cells).

---

## 6. Horizontal containment — non-negotiable

No `DataTable` may ever make the document body scroll sideways, at any viewport width. Every
layer of the tree — `DataTable`'s own wrapper, the desktop grid's scroll container, the
grid's `sx`, the rail-equivalent flex rows in the mobile card list — sets
`minWidth: 0` alongside `width: '100%'` / `maxWidth: '100%'`.

**`min-width: 0` is load-bearing, not cosmetic.** A flex item's `min-width` defaults to
`auto` — its min-content width — so without an explicit override, any descendant reporting a
large intrinsic inline size (a wide table, a long unbroken string, an unwrapped id) cannot be
shrunk below that width, and it widens the whole flex chain it sits in, all the way out to
the app shell (see `apps/web/src/components/common/Layout.tsx`, which documents the exact
same rule for the reverse reason: it's what a `DataTable` embedded in that flex child
*requires of its host*). Wide content is meant to scroll inside its own `overflow-x: auto`
container, never on `<body>` — `DesktopGridRenderer`'s `data-testid="datatable-scroll-container"`
box is that container on desktop/tablet, and it also carries `data-virtualized`, published as
a test hook for §12.

---

## 7. Layout switch — container width, not viewport width

`useDataTableLayout` (`useContainerLayout.ts`) resolves one of three layouts —
`'mobile' | 'tablet' | 'desktop'` — from **the table's own container width**, not
`window.innerWidth`. A `DataTable` inside a 400px drawer on a 1440px desktop must get cards;
a viewport media query would hand it the full desktop grid and it would be unusable. CSS
container queries cannot help here either, because a card list and a `DataGrid` are
genuinely different component trees — a container query can restyle an already-rendered
tree, but it cannot decide *which* tree renders. Measurement therefore has to reach
JavaScript, and `ResizeObserver` is the cheapest way to get there.

### 7.1 The three layouts and their thresholds

```
useDataTableLayout(width):
  width < mobileBreakpoint (default 600)   -> 'mobile'
  width < tabletBreakpoint (default 1200)  -> 'tablet'
  otherwise                                -> 'desktop'
```

600px is MUI's `sm` — below it, a table cannot show a headline plus one supporting column
without either horizontal scrolling or unreadable truncation, which is where cards win.
1200px is MUI's `lg`, chosen because it's the **same** threshold the desktop grid already
used to fold `detail` columns away — so the tablet band is, by construction, exactly "the
widths at which columns are being hidden," which is exactly the band that needs a row
expander (§9) to make them reachable again.

`rendererForLayout` maps the three layouts onto exactly **two** renderer modules:
`'mobile'` → `mobile/CardListRenderer`; `'tablet'` and `'desktop'` both →
`desktop/DesktopGridRenderer`, differing only by its `variant` prop.

### 7.2 A measured width of `0` means "not measured yet"

`useContainerWidth` ignores any measurement that is `0`, negative, non-finite, or absent —
that is what a `display: none` ancestor, a not-yet-laid-out node, and jsdom's layout-free DOM
all report, and none of those mean "this table is genuinely 0px wide." Resolving `0` to
`'mobile'` would flash the wrong renderer on every single mount, including a full-width
desktop table, for the one frame before layout completes.

Before the first real measurement lands, the hook falls back to a **viewport** media query
(`useViewportLayout`, using the same 600/1200 thresholds against MUI's own breakpoints) so
the table renders *something* plausible immediately rather than delaying render until
`ResizeObserver` fires. On a normal full-width page the viewport and the container agree, so
the fallback is simply correct; inside a narrow drawer it is wrong for exactly one frame,
which is strictly better than being wrong forever (`SwaggerModule`-style silent failure) or
never rendering at all.

`ResizeObserver`'s callback prefers `entry.contentBoxSize[0].inlineSize` (the spec'd field)
and falls back to `entry.contentRect.width` (the older field, and what most test doubles
provide) — measured before paint via `useLayoutEffect`, so a correctly-sized container never
shows a frame of the fallback layout at all.

### 7.3 Container overrides don't break tablet's own contract

A caller may override `mobileBreakpoint` above `tabletBreakpoint` by mistake; `useDataTableLayout`
clamps `tablet` to `Math.max(mobile, tablet)` before calling the pure `layoutForWidth`, so an
inverted pair degrades to "mobile wins" rather than producing an unreachable middle band.

### 7.4 State lives above the renderers

Selection, pagination, sort and filters are controlled props owned by the calling page (§5).
The *only* state a renderer owns is which rows/cards happen to be expanded right now — pure
presentation, and meaningless in whichever layout is being switched to. That is what makes
rotating a device, dragging a drawer wider, or resizing a browser window swap the rendered
tree without losing a single selected id, the current page, the active sort, or an applied
filter.

For the same reason, the filter bar (§10) and the view bar — column visibility, density,
export (§11, §13) — are drawn once, by `DataTable` itself, *above* whichever renderer is
active, rather than owned by a renderer: their *shape* is a layout decision (a row / a
collapsed panel / a full-screen sheet), not a row-presentation one, and a renderer that owned
either bar's open state would discard it on every resize.

---

## 8. Mobile layout — the card list

`mobile/CardListRenderer.tsx` consumes the exact same `DataTableRendererProps` the desktop
grid does, from the exact same `DataTableColumn[]`. A page never declares a card layout
separately — the `priority` it already wrote for the grid produces the headline, the body,
and the collapsed detail region.

### 8.1 Card anatomy

One `DataCard` (`mobile/DataCard.tsx`) per row, rendered as an `<li>` inside a `role="list"`
container:

- **Header** — an optional selection checkbox, the `primary` columns as the headline (first
  `primary` column bold, `subtitle2`; any further `primary` columns as secondary text beneath
  it), and a trailing row-actions overflow menu.
- **Body** — `secondary` columns as stacked label/value pairs (`CardField`), separated from
  the header by a `Divider`.
- **Detail** — `detail` columns, behind a "More details" toggle, **closed by default**
  (`Collapse`, `unmountOnExit`). Opening it suspends the card's own render-skipping (§12.2):
  a card whose height is actively changing under the user's finger must stay fully rendered.

`column.align` is a **grid** concern (§4) and does not cross into a card: a card's label sits
above its value, and the pair has nothing else to align against, so a value is always
start-aligned regardless of what the column declares — including under RTL, where "start"
still means the correct edge and a hardcoded `left` would not.

### 8.2 Touch targets (issue #243, origin numbering)

Every interactive control on a card is **≥44px** in both axes, and none is hidden with
`opacity: 0` while remaining hit-testable — a card list is a touch surface first, and an
invisible-but-tappable control is precisely the bug #243 was filed against (a hover-revealed
control at `opacity: 0` that stayed fully tappable on a touch device). There are no
hover-revealed affordances on a card at all.

### 8.3 Truncation is tap-to-expand

A `truncate: true` column clamps to two lines (`ExpandableValue` in `CardField.tsx`) and
expands **in place on tap** — `ButtonBase`, real button semantics, `aria-expanded` — rather
than the grid's hover tooltip, which does not exist on a touch device. The button's
accessible name is `"Expand {label}"`/`"Collapse {label}"`, naming the *label*, not the
(potentially very long) value: announcing the whole value as the button's own name would be
unusable.

### 8.4 Pagination and sort have no grid equivalent to fall back to

`CompactPagination` replaces MUI's `TablePagination`, whose rows-per-page select, "1–25 of
137" text, two arrow buttons and footer padding together run to roughly 420px of intrinsic
width — overflowing a 360px screen or forcing the very horizontal scroller the card layout
exists to remove. It offers prev / range / next only; page size is not adjustable here (a
desktop-scale concern — nobody sets 100-per-page on a phone), though a page can still change
it programmatically since pagination stays fully controlled.

`CardSortControl` exists because a card has no clickable column header: without it, a sort
the page declared would still be *held* correctly across a layout switch (§7.4) but would be
*unreachable* while the phone layout is active — worse than the grid's own affordance. It
offers a field picker (only `sortable: true` columns) plus a direction toggle; "Default" maps
to `onSortChange(null)`.

### 8.5 Touch and keyboard rules (hard requirements)

- Every interactive element ≥44×44px (WCAG 2.5.8), including the search field's own input box.
- No control ever `opacity: 0` while `pointer-events` remains anything but `none` (§8.2).
- Selection, row-actions and the detail toggle are all real `<button>`/`ButtonBase` elements
  — focusable, Enter/Space-activatable, screen-reader operable — never a `div` with an
  `onClick`.

---

## 9. Tablet layout — the real grid, with row expansion

Between the mobile and desktop breakpoints the grid is still the right control — rows are
scannable at 800px in a way cards are not — but it cannot show every column, so `detail`
columns fold away (§3). Folding them away with no route back would make them *unreachable*
rather than *deprioritised*, which is a data-loss bug dressed up as responsive design. So the
tablet variant of `DesktopGridRenderer` adds an expander column that reveals the folded
`detail` columns as label/value pairs, per row, on demand.

### 9.1 Why synthetic rows, not a detail panel

MUI X's `getDetailPanelContent` is declared on the **community** `DataGrid`'s prop types but
is **not implemented** in the MIT package — grepping the built package, the only occurrence
of the name is in `propTypes`; the actual feature is Pro-only. So expansion is built from two
primitives the MIT grid genuinely does implement (`desktop/detailRow.tsx`):

1. A synthetic row (`makeDetailRow`, keyed by `DETAIL_ROW_SOURCE`/`DETAIL_ROW_KEY`, so nothing
   in the caller's own `Row` type can collide with it) is spliced directly after its parent
   row when that parent is expanded.
2. The leading expander column declares `colSpan` covering every column visible for that
   synthetic row, so one cell renders the whole panel (`DetailRowPanel`).

`paginationMode="server"` is what makes splicing safe: the grid never slices the `rows` array
itself in server mode, so injecting a synthetic row cannot push a real row onto a phantom
next page.

**Row height is arithmetic, not `'auto'`.** `detailRowHeight(fieldCount)` computes
`24 + max(1, fieldCount) * 46` rather than using DataGrid's `getRowHeight: () => 'auto'`,
because auto-height depends on a measurement pass, and a panel that measures 0px in a
layout-free environment — jsdom, or any `display: none` ancestor — would clip its own
content. An arithmetic height is deterministic everywhere; the panel scrolls internally
(`overflow: 'auto'`) if a value happens to be longer than the estimate.

The synthetic row also carries a CSS class (`DETAIL_ROW_CLASS`) used to `display: none` —
never `opacity: 0` — the grid's own selection checkbox on that row: a detail row is not a
selectable entity, and `display: none` is what removes it from the accessibility tree and
stops it being hit-testable, rather than leaving an invisible-but-tappable checkbox behind
(the same class of bug as #243, §8.2).

### 9.2 Touch target

The row expander is a real 44×44px `IconButton` wherever row height allows it — a tablet is a
touch device and this is the *only* route to the hidden `detail` columns. It stays at the
grid's own compact size (36px) only when `density === 'compact'`, since a comfortable target
there would exceed the row it sits in.

---

## 10. Filtering and quick search

### 10.1 Server-side is not a choice, it is the whole point

Every table this component serves is server-paginated, so a client-side filter over `rows`
would filter only whatever page happens to be loaded — worse than no filter at all, because
the user believes the wrong answer. Filtering is therefore always server-side by contract:
the table never touches `rows` on account of a filter. It emits a normalized model
(`DataTableFilterModel`) and the owning page maps it onto its endpoint's query parameters and
refetches.

### 10.2 The normalized filter model

```ts
interface DataTableFilter {
  columnId: string;
  operator: FilterOperator;   // 'equals' | 'contains' | 'gt' | 'between' | 'isAnyOf' | …
  value: string | number | boolean | (string | number)[] | null;
}
type DataTableFilterModel = DataTableFilter[];   // AND-ed together, by convention
```

Which operators a column offers is decided by its `filterType` (`operators.ts`), **declared,
not inferred**: inference from the first row's value is unstable in exactly the cases that
matter — an empty page has nothing to infer from, and a nullable column whose first page
happens to be all `null` would silently offer text operators for what is actually a number.
The default sets are deliberately narrow (six operators on a text column is a menu nobody
reads):

| `filterType` | default operators |
| --- | --- |
| `text` | contains, equals, startsWith, isEmpty |
| `number` | equals, gt, lt, between |
| `date` | before, after, between |
| `enum` | is, isNot, isAnyOf |
| `boolean` | is |

A column that genuinely needs more pins them explicitly:
`filterable: ['contains', 'endsWith', 'isNotEmpty']`.

#### Only complete filters are ever emitted

The filter editor keeps an in-progress filter as a **local draft** and never calls
`onFiltersChange` for it — `isFilterComplete` (`filterModel.ts`) checks operand arity (0 for
`isEmpty`/`isNotEmpty`, 2 for `between`, `'many'` for `isAnyOf`/`in`, 1 otherwise) and rejects
an empty string, an incomplete pair, or an empty set. Emitting
`{ columnId: 'status', operator: 'is', value: '' }` on the first click of "Add filter" would
make the page refetch against a meaningless parameter.

### 10.3 The filter surface, per layout

| layout | surface |
| --- | --- |
| `desktop` | an always-visible filter row above the grid |
| `tablet` | the same row, collapsed behind a "Filters" button + a count badge |
| `mobile` | a **full-screen sheet** — chips become a scrollable strip |

The phone case is a sheet rather than a squeezed-down inline row for the same reason the card
list exists at all: a multi-control filter form at 360px is either unusable or pushes the
page sideways. A `Dialog fullScreen` sheet gets the full width, a stacked form, and a real
focus trap (§14.4) for free.

### 10.4 Quick search — the debounce is on the *emission*, not the input

`QuickSearchField` is the whole point of a subtlety worth stating precisely: a naive debounce
holds the input's own displayed `value` back too, so the caret visibly lags a keystroke or
two behind a typist on a slow device. Here the `<input>` is driven by local state and repaints
on every keystroke — typing never feels laggy — while `onChange`, the thing that actually
costs an HTTP round trip, fires only once the user has paused for `debounceMs` (default 300).
A page can therefore refetch directly from `onChange` with **no debounce of its own** — that
is the contract the prop documents. Clearing the field (the × button) is exempt: it is a
single explicit gesture, emitted immediately, since waiting 300ms to un-filter a table on a
deliberate click reads as a broken button.

Staying controlled without fighting the parent: an `emittedRef` remembers the last term this
component itself put on the wire, so a change arriving from *outside* — a URL restore, a
"clear all filters" button, a back-navigation — is distinguishable from the echo of the
component's own emission, and only the former re-seeds the input.

### 10.5 URL addressability (opt-in helper)

`filter/filterUrl.ts` offers `readDataTableUrlState` / `writeDataTableUrlState`, wired in by a
page that already owns a `useSearchParams`, never automatically — a table rendered by a page
with no router dependency shouldn't be forced to grow one. Wire format: one repeated `filter`
param per filter (`columnId:operator[:value]`, each segment `encodeURIComponent`-ed, a
multi-value operand `,`-joined) plus a single `q` param for quick search. The operator itself
determines the operand's shape on decode (`between` → a pair, `isAnyOf` → a set, everything
else → a scalar), so the wire format carries no separate type tag for that. Scalar *type*
(number vs. the literal text `'3'`) is the one thing a URL genuinely cannot carry on its
own — passing the table's `columns` to the reader lets each value be coerced by its column's
`filterType`; omitting them means every scalar decodes as a string. A malformed or
hand-edited filter segment decodes to `null` and is silently dropped, never thrown.

---

## 11. Column visibility, density and per-user persistence

Namespace: `user_settings.dataTables`, a map keyed by `tableId`
(`apps/api/src/common/schemas/user-settings-namespaces.schema.ts`). Round-trips through the
existing `GET`/`PATCH /api/user-settings` endpoints — no new endpoint, no new client layer,
no new permission.

### 11.1 `tableId` — the whole opt-in

Supplying `tableId` on `DataTable` turns on persistence; omitting it keeps every visibility/
density/sort/page-size control fully working, just session-scoped. The id is the storage key
and is chosen by the page rather than derived from a route or a label, so it survives a
rename or a URL restructuring.

### 11.2 Stored shape

```ts
interface DataTableEntry {   // one table's persisted layout
  visibleColumns?: string[];  // bare id = visible, '-id' = explicitly hidden
  density?: 'compact' | 'standard' | 'comfortable';
  sort?: { field: string; direction: 'asc' | 'desc' };
  pageSize?: number;
}
```

Server-enforced bounds exist because this is a JSONB blob the user themselves writes via
PUT/PATCH, i.e. a storage-exhaustion vector without them: at most 40 table entries per user
(`DATA_TABLE_MAX_TABLES`, enforced in the service layer, since `z.record()` cannot express a
max-key-count refinement that survives the record type), at most 60 column ids per entry, and
at most 64 characters per id. The zod schema is `.strict()` — an unknown key in an entry is a
400. **No field anywhere in this namespace carries `.default()`.**

### 11.3 The `-`-prefix encoding, and why it exists

A `string[]` can express "these ids are visible," but not "…and these other ids existed and
were deliberately unchecked" — without that second bit, a column added to a table *after* a
user last saved a layout would be indistinguishable from one they had explicitly hidden, and
would silently vanish for that user forever. So `visibleColumns` carries every column known
at write time: visible ones as a bare id, hidden ones prefixed with `-`. A current column
mentioned by *neither* list is new since the layout was stored, and falls back to its
priority-derived default (visible, unless `hideable: false`).

This degrades correctly for any naive consumer reading the field as a plain list of visible
ids — `-lastError` simply matches no real column id and is ignored, leaving the bare ids as
exactly the visible set.

### 11.4 The absent-key rule — and why it is load-bearing

**Absent means "use the application's built-in default," computed at read time, and a
default is never written back.** This governs `visibleColumns`, `density`, `pageSize`,
`sort`, and — in the sibling `navigation` namespace — `railCollapsed` alike; it is stated once
in the API schema's file header rather than per field, because it is the same argument every
time: if `visibleColumns` defaulted to today's column list the first time a user merely
opened a density menu — touching an *unrelated* preference — the persisted entry would
materialise a frozen column set at that moment. Every column added to that table afterward
would be silently invisible to that user forever, with no error and no visible cause, and the
only remedy would be a manual settings reset.

`resolveUserVisibleColumnIds` (`layoutModel.ts`) implements the read side exactly this way:
no stored entry, or a column the stored entry never mentions, both resolve to "visible" —
the same answer, reached by the same code path, whether the user has customized nothing yet
or the table has simply grown a column since they last touched the picker.

### 11.5 Bounds

`encodeVisibility` never writes more than `DATA_TABLE_MAX_VISIBLE_COLUMNS` (60) entries or an
id longer than `DATA_TABLE_MAX_ID_LENGTH` (64) characters — visible ids are packed first,
since losing a hidden marker only costs the new-column protection for that one column, while
losing a visible id would actively hide something the user chose to see.

### 11.6 PATCH semantics — entry-replace, not deep-merge

`PATCH /api/user-settings` merges the `dataTables` **namespace** per table id, but replaces
each **entry** wholesale: `{ dataTables: { jobs: { pageSize: 100 } } }` drops that entry's
previously-stored density and column list rather than patching just `pageSize`. Every write
from `useDataTableLayoutPrefs` therefore sends the table's *complete* in-session entry, which
is cheap because the hook already holds the fully resolved layout in React state. "Reset to
defaults" is expressed as the merge-patch delete, `{ dataTables: { [tableId]: null } }` —
removing the entry entirely and freeing its slot against the 40-table cap — rather than
storing `{}`, which would be a second way to spell "absent" and reintroduce the same ambiguity
§11.4 exists to close.

### 11.7 Write discipline: debounced, fire-and-forget, in-session authoritative

Three properties, all following from one framing: a layout preference is UI state that
happens to be backed up, not domain data being submitted.

- **In-session state is authoritative; the server copy is a cache.** The layout a user sees
  comes from React state and applies the instant they click. The write happens afterward and
  its response is never read back into what's on screen.
- **Fire-and-forget.** A rejected write is logged (`console.warn`) and dropped. Making the
  checkbox depend on a round trip would trade a working control for a spinner, and on
  failure, a control that snaps back with no visible reason.
- **Debounced** (`DATA_TABLE_PERSIST_DEBOUNCE_MS`, 500ms). Flipping four checkboxes in a row is
  one intent and should cost one request — the debounce is on the *write*, never on the state
  update the user actually sees.

Deliberately sent with **no `If-Match` header**, even though `PATCH /api/user-settings`
supports optimistic concurrency via a `version` field. That protection is right for
`useUserSettings`, which holds the whole settings object behind a form and should surface "this
was updated elsewhere." It is the wrong tool here: this write touches exactly one key of one
namespace, is debounced, and its response is discarded — sending a version read at mount
would make a column-visibility toggle fail on a race with a concurrent write to an *unrelated*
namespace (a theme toggle in another tab bumps the same `version`). The server-side merge is
already per-table and per-namespace, so there is no lost update to protect against — two
concurrent writers of the *same* table entry is just one user racing themselves.

A pending debounced write is flushed (not cancelled) on unmount, so a route change immediately
after the last click still lands it.

### 11.8 Resolving a stored layout against the CURRENT columns

Two composed rules, both in `layoutModel.ts`:

- **Visibility**: `resolveVisibleColumnIds` intersects the user's stored choice with the
  *layout's own* fold (`detail` columns hidden on tablet) — never overrides one with the
  other. A user's "hide this" must win at every width; a `detail` column marked visible in a
  desktop-saved layout must still fold away at 800px, or it would reintroduce exactly the
  horizontal scroll the fold exists to prevent.
- **Sort**: `resolveStoredSort` returns `null` if the stored field no longer exists or is no
  longer `sortable` — restoring a sort the server would reject, or the header can no longer
  show, is worse than opening in the page's own default order.

`sanitizeStoredLayout` additionally narrows any server payload defensively (the blob is
user-writable JSON another client, an older build, or a hand-edited row can put anything
into), dropping unrecognized shapes rather than crashing a render or echoing an unknown key
back on the next `PATCH` and taking that write down with a 400.

---

## 12. Row virtualization

### 12.1 Desktop/tablet: DataGrid's own virtualizer, actually turned on

MUI X virtualizes rows for free — with one precondition easy to miss:
`enabledForRows: !disableVirtualization && !autoHeight && HAS_LAYOUT` (from the package's own
source). `autoHeight` **disables row virtualization**, and `autoHeight` is exactly this
renderer's documented default whenever a caller omits `height` — the table grows with its
rows and the *page* scrolls. So the naive default table renders every loaded row regardless
of a virtualizer being present at all.

`planGridVirtualization` (`gridVirtualization.ts`) is the fix, and it's a threshold, not a
blanket switch: past `GRID_VIRTUALIZATION_ROW_THRESHOLD` (50) loaded rows, auto-height is
dropped for a computed bounded viewport, which is the only condition under which the grid's
built-in windowing can actually run. Turning every table into an internally-scrolling box
unconditionally would be a worse regression than the one being fixed — auto-height is correct
for a 10- or 25-row page. An explicit `height` prop always forces the bounded path regardless
of row count, since the caller has already asked for internal scrolling.

Stated plainly in the source: every target table is server-paginated and the MIT `DataGrid`
caps a page at 100 rows, so the realistic worst case is ~100 rows plus a handful of synthetic
tablet detail rows. This is **robustness for large page sizes, not the performance
strategy** — the performance strategy is server-side pagination itself. `disableVirtualization`
stays at its own default (`false`) throughout; this module only decides whether the grid is
*allowed* to use its own windowing.

### 12.2 Mobile: render-skipping, and explicitly NOT a virtualizer

Cards are variable-height — a card's body grows with its `secondary` column count and its
detail region expands in place. A windowing virtualizer needs a height estimate per item, and
a *wrong* estimate is not a small inefficiency, it is a scroll position that visibly jumps
under the user's thumb — exactly the shipped bug the origin tracked as its own issue #237
(origin numbering): a placeholder computed for the wrong column count made scrolling jump. An
incorrect virtualizer is worse than none.

So `virtualization/cardVirtualization.ts` is deliberately not a virtualizer:
`content-visibility: auto` lets the browser skip layout/paint for an off-screen card while
keeping it focusable and find-in-page-able (unlike `display: none`), and
`contain-intrinsic-size: auto <measured>px` supplies the placeholder height for a skipped
card — the `auto` keyword makes the browser remember each card's *last rendered* size and
prefer it over the estimate, so the estimate only has to be right for a card that has never
yet been on screen, and it's a **measurement of a real card in this very list**
(`useMeasuredCardHeight`), not a guess derived from a column count. The first card in the list
is excluded from skipping — it's the one being measured, and it's on screen by definition
regardless. Below `CARD_VIRTUALIZATION_MIN_ROWS` (20) rows, nothing is applied at all: below
that size there's nothing worth skipping and the plain list is simpler and faster.

Card images also get `loading="lazy"` / `decoding="async"` automatically, applied to whatever
a column's `render` produced — a long card list of thumbnails would otherwise fetch every
image on the page at once — unless the author explicitly set `loading` already.

---

## 13. CSV export

Built entirely against the **column contract**, never against DataGrid — `GridToolbarExport`
would serialize the grid's own rows, which exist in one renderer out of two and would
silently produce a different file on a phone than on desktop. One code path serves all three
layouts.

### 13.1 The surface, per layout

Everything routes through `export/exportModel.ts` and `export/csv.ts`. Every table can
export its current page with no configuration; supplying `csvExport.fetchAllRows` adds an
"export all matching rows" option that replays the page's *own* fetch callback page by page.

### 13.2 Escaping rules

`export/csv.ts` is intentionally pure — no React, no DOM — so its rules are testable as
arithmetic:

1. **RFC 4180 quoting.** A field containing a comma, double quote, CR or LF is wrapped in
   double quotes with internal quotes doubled; rows are separated by CRLF (what Excel
   expects, and what the RFC specifies).
2. **Formula-injection neutralization.** A cell whose text starts with `=`, `+`, `-`, `@`, a
   leading tab, or a leading CR is executable the instant the file is opened in Excel, Sheets
   or LibreOffice (`=cmd|'/c calc'!A1` is the textbook proof; see OWASP "CSV Injection"). Such
   a field gets a leading apostrophe — the prefix every major spreadsheet treats as "this is
   literal text." **Exempted: text that parses as a well-formed number** — otherwise
   neutralizing blindly would turn the number `-5` into the text `'-5`, breaking every numeric
   column that can go negative, a real regression traded for a theoretical attack.
3. **A UTF-8 BOM**, prepended to the file (never to a field, so the serializer stays
   composable) — Excel on Windows reads a BOM-less UTF-8 CSV as the local ANSI code page,
   turning `José` into `JosÃ©`.

`escapeCsvField` writes an empty string for `null`/`undefined`, never the display em dash
(`—`) `formatColumnValue` shows on screen: the dash is a *display* convention for a human
reading a rendered table, and writing it into a CSV would turn "no value" into a literal
three-byte string every downstream import would then have to special-case.

### 13.3 What's on a row: `value`, never `render`

A column whose cell is a `<Chip>` exports the **scalar** behind the chip. Serializing a
`ReactNode` is either impossible or, worse, silently lossy (`[object Object]`, or a chip's
label without the meaning behind it) — this is the entire reason `render` and `value` are two
separate fields in the contract (§4). A column with only `render` and no scalar exports an
empty cell; declare `value`, or set `exportable: false` for a column that must never leave
the app at all (a share token, PAT material).

### 13.4 Column scope: what's on screen, and nothing the API didn't already return

Exported columns are exactly the ones the user currently has *visible* (§11), minus any
declaring `exportable: false` — never every declared column, and never the grid's own
column-menu concept, which doesn't exist here (§4). "All matching rows" replays the page's
*own* fetch callback rather than issuing a new, elevated query: the export is subject to
precisely the same authorization and the same active filters as the table itself, because it
literally makes the same request the table would have made anyway, just repeatedly.

`collectAllRows` (`exportModel.ts`) walks pages of `DATA_TABLE_EXPORT_FETCH_PAGE_SIZE` (250)
rows until the callback runs dry, an explicit `maxRows` ceiling (`DATA_TABLE_EXPORT_MAX_ROWS`,
10 000) is hit, or a hard-coded `MAX_FETCH_PAGES` (200) safety bound stops a callback that
ignores `page` and returns the same page forever — a bound, not a preference: without one, a
single click against a large enough table issues thousands of requests and builds a
multi-hundred-megabyte string in a tab that then dies. The download itself
(`downloadCsv`) is a `Blob` + object URL + synthetic anchor click — the only approach that
works with no server round trip and no `data:` URI length ceiling — and returns `false`
rather than throwing when the environment can't support it, so a failed download never takes
a render down with it.

---

## 14. The accessibility contract

Enforced by a shared conformance battery
(`__tests__/conformance/runDataTableConformanceSuite.tsx`, run against *both* renderers by
`DataTableConformance.test.tsx`) rather than left to per-page review, so every table this
component ever serves gets the same guarantees for free.

### 14.1 Renderer semantics

- The desktop/tablet grid announces as a **grid**, named via `ariaLabel`, with real row/column
  context (DataGrid's own semantics).
- The card list announces as a **list** (`role="list"`, `<Stack component="ul">`), and each
  card is labelled by its own `primary` headline (`rowAccessibleName`, shared with the grid's
  row-disambiguation, §14.6) so a screen-reader user can navigate by item name rather than by
  reading every field of every card to tell them apart.

### 14.2 Live-region announcements

- Selection: `"N of M selected"` (`BulkActionBar`), on both renderers, with `M` always the
  *page's own* loaded row count — never `pagination.total` — since selection itself is
  page-scoped (§5).
- Filtering: `"Filtered to N results"` once a filter or quick-search term is active and the
  page reports a `pagination.total`; silent when neither is true, since there's nothing
  truthful to say about a query the page never reports a count for. Singularizes to
  `"1 result"`.

### 14.3 Focus management

The phone filter sheet, the desktop column-picker menu, and a row's overflow action menu all
trap focus while open and restore it to the triggering control on close — standard modal
focus discipline, asserted per-surface rather than assumed from the underlying MUI component.

### 14.4 Keyboard model

- Interactive content inside a custom `render` cell is reachable by Tab and activatable, on
  both renderers.
- Every row checkbox is independently reachable and toggleable by keyboard (not just by
  pointer-driven row click).
- The tablet row-expander is a real `<button>`, reachable and activatable by keyboard — never
  a styled `div`.
- The card sort control and `CompactPagination` are fully keyboard-operable; no pointer-only
  affordance exists in the mobile layout.
- Bulk select-all is reachable and toggleable by keyboard on both renderers.

### 14.5 The issue #243 guard (touch-target invisibility), swept everywhere

`assertNoInvisibleHitTargets` (`testUtils/a11yGuards.ts`) is the one shared implementation of
a check that was, before this component's own issue #257 (origin numbering), copy-pasted with
small drifts into four separate test files. It sweeps every visible interactive control
(`button, [role="button"], .MuiCheckbox-root, a[href]`, extended with `[role="menuitem"]`
where a suite's controls are menu items) and fails, **naming the offending control**, if any
one is `opacity: 0` while its `pointer-events` remain anything but `none`. Two deliberate
exclusions: a bare `<input>` under a painted checkbox SVG (the hit target *should* coincide
with the visible affordance there — the opposite of the bug), and MUI X's own hover-revealed
column-header chrome, which this component doesn't own and which is reachable by keyboard
regardless.

### 14.6 Disambiguated control names

Every control whose bare label would otherwise repeat identically across every row — "Select
row," "Retry," "Show details" — is disambiguated with the row's own accessible name:
`rowAccessibleName` (`desktop/columnAdapter.ts`) derives it from the first `primary` column
still on screen (respecting the user's own visibility choice), shared verbatim by the grid's
selection checkbox, the row-actions button/menu, the tablet expander button, and the card's
own headline-as-aria-label — so "Retry for auto_tagging" replaces a bare "Retry" repeated
identically on every row, whichever renderer is active.

### 14.7 Automated checks (axe)

The conformance suite runs `axe`/`vitest-axe` against both renderers, in both light and dark
theme, plus the tablet grid variant specifically with a row expanded — including two real
violations the component fixes rather than works around: the grid's own header "select all"
checkbox setting `aria-checked="mixed"` without the underlying native indeterminate DOM
property (`IndeterminateCheckbox`, using DataGrid's own public `baseCheckbox` slot rather than
an internal reach-around), and DataGrid's single static "Select row" locale string for every
row's own checkbox (overridden via the public `checkboxColDef` extension point, not by
replacing the built-in column).

---

## 15. Testing notes

- **jsdom performs no layout.** MUI X's virtualizer measures 0×0 and renders zero rows, and
  the project-wide no-op `ResizeObserver` mock is not sufficient for this component's tests —
  `__tests__/testUtils/layoutStubs.ts` installs `installLayoutStubs()`, which stubs the width
  getters and installs a `ResizeObserver` whose `observe()` synchronously invokes its
  callback. For layout-switch tests specifically, `matchMedia` is additionally **pinned to a
  fixed 1440px viewport**, so a `mobile` result in a test can only have come from the
  *container* measurement (§7.2), never from the viewport fallback quietly doing the work
  instead.
- **The contrast test suite** (`DataTableContrast.test.tsx`, `testUtils/contrast.ts`) re-pins
  every color-contrast ratio it asserts against **this repo's own palette** — a plain
  `#1976d2`-on-`#ffffff` style pin copied from elsewhere would silently stop meaning anything
  the day this app's theme changes independently of wherever the number was copied from.

---

## 16. Out of scope

- **Migrating `UserList`, `AllowlistTable`, `PersonalAccessTokens` and a fourth table onto
  `DataTable`.** Deliberately split out into
  [#67](https://github.com/marinoscar/EnterpriseAppBase/issues/67) so the component itself
  could land as one reviewable unit (§1). This document has no worked example against a real
  page of this repo's until that lands.
- **A fully custom table with no DataGrid dependency.** Rebuilding virtualization, the
  keyboard model and accessibility from scratch would be a permanent maintenance commitment
  for no gain on the two-thirds of the problem DataGrid already solves for free.
- **Horizontal scroll as the mobile answer**, instead of cards. Keeps the page from breaking
  but leaves the table itself genuinely unusable on a phone — the actual complaint this port
  exists to fix.
- **A `MobileList` component pages opt into separately.** Two components means two call
  sites per page and guarantees the two drift from each other over time.
- **Skipping the tablet band entirely** (mobile ↔ desktop only). Between 600 and 1200px the
  grid is still the right control, but it cannot show every column — exactly the band that
  needs a row expander.
- **Normalizing this repo's two list-pagination shapes.** Out of scope of the whole epic; see
  `docs/specs/api-documentation.md` §8.
