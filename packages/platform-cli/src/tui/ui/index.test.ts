import { describe, expect, it } from 'vitest';

import * as ui from './index.js';

describe('@marinoscar/platform-cli/tui/ui', () => {
  it('exports the component kit and the promoted building blocks', () => {
    for (const name of [
      'EventLog',
      'SegmentMeter',
      'MeterLegend',
      'StatusLine',
      'ActiveItems',
      'RunSummary',
      'allocateMeterCells',
      'Frame',
      'KeyHints',
      'Field',
      'ErrorNotice',
      'ScrollBox',
      'useTerminalSize',
      'formatDuration',
      'NARROW_COLUMNS',
      'TINY_COLUMNS',
    ]) {
      expect(ui, name).toHaveProperty(name);
    }
  });
});
