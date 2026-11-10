/**
 * Reference example (PP-14.24b): an app extends the packaged "Download your
 * data" page through its `slots`, with no package edit.
 *
 * `BeforeContent` is a notice under the header (how long a finished export
 * stays available). `Columns` and `RowActions` are the exports list's slots,
 * which the page forwards to the list it draws: this reuses the "Rows" column
 * and the "Copy name" action of `ExportsListSlots.example.tsx`. Every slot reads
 * only the data the page already holds; none calls the API.
 *
 * Wire it where the route renders the page (`App.tsx`):
 * `<DataExportPage slots={DATA_EXPORT_PAGE_SLOTS} />`. The reference app does
 * not wire it: it ships compiled and tested, like the other web examples.
 */
import { Alert } from '@mui/material';
import type { DataExportPageSlots } from '@marinoscar/platform-web/exports/ui';

import { exportsListSlots } from './ExportsListSlots.example';

/** The notice under the header. */
export function ExportRetentionNotice() {
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      A finished export stays available for 7 days. Download it before then.
    </Alert>
  );
}

/** The page slots this example fills. Keep it a module constant. */
export const DATA_EXPORT_PAGE_SLOTS: DataExportPageSlots = {
  ...exportsListSlots,
  BeforeContent: ExportRetentionNotice,
};
