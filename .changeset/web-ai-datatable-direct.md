---
"@marinoscar/platform-web": minor
---

The AI pages draw the model catalogue and the usage breakdowns with the datatable slice's `DataTable` directly. Removed `AiWebAdapters.DataTable` and the `AiDataTableComponent`, `AiDataTableProps`, `AiTableColumn`, `AiTableColumnPriority` and `AiTableRowAction` types of `/ai/headless`; the `ai` slice now depends on `datatable`.
