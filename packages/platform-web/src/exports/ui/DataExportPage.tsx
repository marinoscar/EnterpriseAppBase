// =============================================================================
// DataExportPage (issue #744): `/settings/data-export`, "Download your data"
// =============================================================================
//
// Every source the caller may use (their own data for everyone; their
// organization's for its administrators), the request dialog and the recent
// exports, polled while one is in progress. A user settings card with no
// permission: the API grants `user-data` to every role through
// `user_settings:read`.
// =============================================================================

import { Alert, Box, Button, Card, CardContent, Container, Skeleton, Stack, Typography } from '@mui/material';
import { useState, type ComponentType, type ReactElement } from 'react';

import { PageSlotsFrame } from '../../core/index.js';
import type { PageSlotsBase } from '../../core/index.js';
import { useExportSources, useExports } from '../headless/hooks.js';
import { DATA_EXPORT_DESCRIPTION, DATA_EXPORT_TITLE } from './copy.js';
import { ExportDialog, type ExportFormSlotProps } from './ExportDialog.js';
import { ExportsList, type ExportsListSlots } from './ExportsList.js';

/**
 * The slots of {@link DataExportPage}: the page-slot contract
 * ({@link PageSlotsBase}) plus the exports list's `Columns` and `RowActions`
 * (forwarded to {@link ExportsList}) and the request form by source id.
 * `Sections` is drawn at both ends of the body, around the error, the
 * "New export" button and the recent exports.
 *
 * @example
 * ```tsx
 * <DataExportPage slots={{ RowActions: ({ row }) => <ReportProblem exportId={row.id} /> }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface DataExportPageSlots extends PageSlotsBase, ExportsListSlots {
  /** A source's own request form, by source id (passed to {@link ExportDialog}). */
  form?: Readonly<Record<string, ComponentType<ExportFormSlotProps>>>;
}

/**
 * Props of {@link DataExportPage}.
 *
 * @stability experimental
 */
export interface DataExportPageProps {
  /** Optional extension slots; omitted, the page renders exactly as it always did. */
  slots?: DataExportPageSlots;
}

/**
 * The "Download your data" page.
 *
 * @param props - see {@link DataExportPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/settings/data-export" element={<DataExportPage />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function DataExportPage(props: DataExportPageProps = {}): ReactElement {
  const { sources, isLoading: sourcesLoading, error: sourcesError } = useExportSources();
  const { exports, isLoading, error, refresh } = useExports();
  const [open, setOpen] = useState(false);

  const { slots } = props;

  return (
    <Container maxWidth="md">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <PageSlotsFrame
          slots={slots}
          headerProps={{ title: DATA_EXPORT_TITLE, description: DATA_EXPORT_DESCRIPTION, actions: null }}
          header={
            <>
              <Typography variant="h4" component="h1" gutterBottom>
                {DATA_EXPORT_TITLE}
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 3 }}>
                {DATA_EXPORT_DESCRIPTION}
              </Typography>
            </>
          }
        >
          {sourcesError ?? error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {sourcesError ?? error}
            </Alert>
          ) : null}
          <Stack direction="row" sx={{ mb: 2 }}>
            <Button variant="contained" onClick={() => setOpen(true)} disabled={sourcesLoading || sources.length === 0} sx={{ minHeight: 44 }}>
              New export
            </Button>
          </Stack>
          <Card variant="outlined" aria-busy={isLoading}>
            <CardContent>
              <Typography variant="h6" component="h2" gutterBottom>
                Recent exports
              </Typography>
              {isLoading ? (
                <Stack spacing={1} aria-label="Loading your exports">
                  {[0, 1].map((index) => (
                    <Skeleton key={index} variant="rounded" height={48} />
                  ))}
                </Stack>
              ) : (
                <ExportsList exports={exports} sources={sources} slots={slots} />
              )}
            </CardContent>
          </Card>
        </PageSlotsFrame>
        <ExportDialog open={open} onClose={() => setOpen(false)} sources={sources} onCreated={() => void refresh()} slots={slots} />
      </Box>
    </Container>
  );
}
