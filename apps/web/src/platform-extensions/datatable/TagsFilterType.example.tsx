/**
 * Reference example (PP-14.20): an app adds a filter TYPE to the DataTable, with
 * its own operand editor, without a package edit.
 *
 * A "tags" column stores several labels per row. The five built-in types cannot
 * express "has any of / has all of", and a plain select cannot take free-form
 * values, so the app registers a type: its operators, a chip editor for the
 * operand (type a tag, press Enter, click a chip to remove it) and the rule
 * that matches a row, which a page that filters locally (or a mock server) uses
 * through `matchesFilters`. The table itself never filters rows: the filter
 * model goes to the page, which maps it onto its endpoint.
 *
 * Register once, before the first render (the reference app does not: it ships
 * compiled and tested, like the other web examples):
 *
 * ```ts
 * registerTagsFilterType();
 * const columns = [{ id: 'tags', label: 'Tags', priority: 'secondary', value: tagsValue, filter: { type: TAGS_FILTER_TYPE } }];
 * ```
 *
 * The cell value of a tags column is its tags joined by `,` (`'a,b'`), so
 * sorting and the CSV export have a scalar to work with.
 */
import { Box, Chip, TextField } from '@mui/material';
import {
  registerDataTableFilterType,
  type DataTableFilterValue,
  type FilterValueEditorProps,
} from '@marinoscar/platform-web/datatable/headless';
import { useState, type KeyboardEvent, type ReactElement } from 'react';

/** The type id a column names in `filter: { type }`. */
export const TAGS_FILTER_TYPE = 'tags';

/** The scalar behind a tags cell: the tags joined by `,`. */
export function tagsValue(tags: readonly string[]): string {
  return tags.join(',');
}

function operandTags(operand: DataTableFilterValue): string[] {
  return Array.isArray(operand) ? operand.map(String) : [];
}

/** The chip editor: the operand is the list of chips. Shape of `FilterValueEditorProps`. */
export function TagChipsEditor({ value, onChange, stacked }: FilterValueEditorProps): ReactElement {
  const tags = operandTags(value);
  const [draft, setDraft] = useState('');

  const add = (): void => {
    const next = draft.trim();
    if (next !== '' && !tags.includes(next)) onChange([...tags, next]);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      // Enter adds a chip; it must not submit the surrounding filter form.
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <Box
      data-testid="tags-filter-editor"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', flex: stacked ? undefined : '1 1 220px', minWidth: 0 }}
    >
      {tags.map((tag) => (
        <Chip key={tag} size="small" label={tag} onDelete={() => onChange(tags.filter((t) => t !== tag))} />
      ))}
      <TextField
        size="small"
        label="Add a tag"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        sx={{ minWidth: 140, '& .MuiInputBase-root': { minHeight: 44 } }}
      />
    </Box>
  );
}

/** Whether a cell's tags satisfy a `hasAny` / `hasAll` / `hasNone` filter. */
export function matchesTags(value: unknown, operator: string, operand: DataTableFilterValue): boolean {
  const have = new Set(String(value ?? '').split(',').filter(Boolean));
  const want = operandTags(operand);
  if (operator === 'hasAll') return want.every((tag) => have.has(tag));
  if (operator === 'hasNone') return !want.some((tag) => have.has(tag));
  return want.some((tag) => have.has(tag));
}

/** Registers the `tags` filter type. Returns the function that unregisters it again (a test). */
export function registerTagsFilterType(): () => void {
  return registerDataTableFilterType({
    type: TAGS_FILTER_TYPE,
    operators: [
      { id: 'hasAny', label: 'has any of', arity: 'many' },
      { id: 'hasAll', label: 'has all of', arity: 'many' },
      { id: 'hasNone', label: 'has none of', arity: 'many' },
    ],
    Editor: TagChipsEditor,
    matches: matchesTags,
    format: (operand) => `#${String(operand)}`,
  });
}
