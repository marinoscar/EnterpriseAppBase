// The screen-reader-only style: the same declarations as
// `@mui/utils/visuallyHidden`, inlined so the package does not import a
// transitive dependency of `@mui/material` it does not declare
// (scripts/check-slice-peers.mjs). Not exported from the slice.
export const visuallyHidden = {
  border: 0,
  clipPath: 'inset(50%)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
} as const;
