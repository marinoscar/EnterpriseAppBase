---
"@marinoscar/platform-web": minor
---

The packaged-page slot contract (PP-14.23, #941) in `@marinoscar/platform-web/core`: `PageSlotsBase` (`Header`, `BeforeContent`, `Sections` rendered at both ends with `position`, `AfterContent`), `TableSlots<Row, Column>` (`Columns`, `RowActions`, `DetailPanel`, `Toolbar`), `PageSlot`, `PageHeaderSlotProps`, `PageSectionsSlotProps`, `SlotTableColumn` and `useTableSlotColumns`. Every slot is optional and a page with none renders the markup it always did. `test/page-slots.contract.test.ts` reads the `ui` entries of the package's `exports` map and fails, naming the page, when an exported `*Page` has no `slots` prop extending `PageSlotsBase`, unless `test/page-slots.exempt.json` lists it with a reason.

The five operations pages take it. `JobsPage` and `JobInsightsPage`: the base slots, `TableSlots` and `Filters`. `WorkersPage`: the base slots, `TableSlots` and `VitalsPanel` (extra section in the node vitals dialog). `DbBackupPage`: the base slots and `RunRowActions` (its `Sections` now also receives `position` and renders at both ends). `DoctorPage`: the base slots and `CheckRowActions`, plus `registerDoctorCheckRenderer(checkId, Component)` (`@marinoscar/platform-web/doctor/headless`) to draw a check's `data` inside its row. The page `Header` slots of the jobs, nodes and doctor pages keep their props and gain `actions`.

Migration note: a `slots.Sections` component written for the database backup page, which rendered once at the bottom, now renders at both ends; return `null` when `position === 'top'`.
