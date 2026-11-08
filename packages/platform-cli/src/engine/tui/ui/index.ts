// The component kit behind `@marinoscar/platform-cli/tui/ui` (RETRO-G1.4, #1068).
// Importing it loads ink; `@marinoscar/platform-cli/tui` never does.
export { EventLog } from './event-log.js';
export type { EventLogProps, TuiLogEvent, TuiLogKind } from './event-log.js';
export { SegmentMeter, allocateMeterCells } from './segment-meter.js';
export type { SegmentMeterProps, TuiMeterSegment } from './segment-meter.js';
export { MeterLegend } from './meter-legend.js';
export type { MeterLegendProps } from './meter-legend.js';
export { StatusLine } from './status-line.js';
export type { StatusLineProps, TuiStatusItem } from './status-line.js';
export { ActiveItems } from './active-items.js';
export type { ActiveItemsProps, TuiActiveItem } from './active-items.js';
export { RunSummary } from './run-summary.js';
export type { RunSummaryProps, TuiSummaryFailure, TuiSummaryStat } from './run-summary.js';
export { middleTruncate, toneProps } from './tone.js';
export type { TuiTone, TuiToneProps } from './tone.js';

// The platform's own building blocks, promoted to public.
export { ErrorNotice, Field, Frame, KeyHints, NARROW_COLUMNS, TINY_COLUMNS, useTerminalSize } from '../layout.js';
export type { FrameProps, TerminalSize } from '../layout.js';
export { ScrollBox } from '../scroll-box.js';
export type { ScrollBoxProps } from '../scroll-box.js';
export { formatDuration } from '../../node/node-dashboard-source.js';
