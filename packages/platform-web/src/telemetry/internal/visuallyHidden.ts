// The screen-reader-only style (issue #704): the same declarations as
// `@mui/utils/visuallyHidden`, inlined so the package does not reach into a
// transitive dependency of `@mui/material`. Not exported.
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
