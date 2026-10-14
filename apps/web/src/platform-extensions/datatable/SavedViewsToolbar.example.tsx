/**
 * Reference example (PP-14.20): saved views through the DataTable `Toolbar`
 * slot and the stored layout's `extra`, with no package edit.
 *
 * A saved view is a named layout the table stores for the user (at most 20 per
 * table, validated by the user-settings API). It restores the platform's own
 * fields (columns, density, sort, page size); what only the app knows, here the
 * filter model, travels in the view's `extra` and the app puts it back through
 * the page's `onFiltersChange`. The toolbar receives the table's layout
 * preferences (`prefs`) and the page's callback, so it needs no state of its own.
 *
 * Wire it where the page renders its table:
 * `<DataTable ... slots={{ Toolbar: SavedViewsToolbar }} />`. The reference app
 * does not wire it: it ships compiled and tested, like the other web examples.
 */
import { Button, MenuItem, Stack, TextField } from '@mui/material';
import type { DataTableFilterModel, DataTableToolbarSlotProps } from '@marinoscar/platform-web/datatable/headless';
import { useState, type ReactElement } from 'react';

/** The key of the view's `extra` that holds the filter model. */
export const VIEW_FILTERS_KEY = 'filters';

/** The filter model a view captured, or `[]` (the stored copy is untrusted: only an array is used). */
export function filtersOfView(extra: Readonly<Record<string, unknown>> | undefined): DataTableFilterModel {
  const stored = extra?.[VIEW_FILTERS_KEY];
  return Array.isArray(stored) ? (stored as DataTableFilterModel) : [];
}

/** `slots.Toolbar`: a name field, "Save view" and a picker that applies a saved view. */
export function SavedViewsToolbar({ prefs, filters, onFiltersChange }: DataTableToolbarSlotProps): ReactElement {
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const save = (): void => {
    const saved = prefs.saveView(name, { [VIEW_FILTERS_KEY]: filters });
    if (saved) {
      setName('');
      setMessage(null);
    } else {
      setMessage(prefs.savedViews.length >= 20 ? 'You can keep 20 views. Delete one first.' : 'Give the view a name (60 characters at most).');
    }
  };

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1, alignItems: { sm: 'center' } }} data-testid="saved-views-toolbar">
      <TextField
        size="small"
        label="View name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={message !== null}
        helperText={message ?? undefined}
        sx={{ minWidth: 180, '& .MuiInputBase-root': { minHeight: 44 } }}
      />
      <Button variant="outlined" onClick={save} sx={{ minHeight: 44 }}>
        Save view
      </Button>
      {prefs.savedViews.length > 0 ? (
        <TextField
          select
          size="small"
          label="Saved views"
          value=""
          onChange={(event) => {
            const applied = prefs.applyView(event.target.value);
            if (applied) onFiltersChange?.(filtersOfView(applied.layout.extra));
          }}
          sx={{ minWidth: 180, '& .MuiInputBase-root': { minHeight: 44 } }}
        >
          {prefs.savedViews.map((view) => (
            <MenuItem key={view.id} value={view.id}>
              {view.name}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
    </Stack>
  );
}
