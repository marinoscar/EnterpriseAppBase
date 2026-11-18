---
"@marinoscar/platform-cli": minor
---

CLI: an ink component kit on the new `@marinoscar/platform-cli/tui/ui` subpath. `EventLog`, `SegmentMeter` (with the pure `allocateMeterCells`), `MeterLegend`, `StatusLine`, `ActiveItems` and `RunSummary` are app-neutral, take their colours from the TUI theme (monochrome under `NO_COLOR`) and narrow below the 56 and 30 column thresholds. `Frame`, `KeyHints`, `Field`, `ErrorNotice`, `ScrollBox`, `useTerminalSize`, `NARROW_COLUMNS`, `TINY_COLUMNS` and `formatDuration` are now public from the same subpath. `@marinoscar/platform-cli/tui` still does not load ink. The built-in `node` screen shows its totals as a meter and its recent jobs as an event log.
