// The default title block of the identity pages (PP-14.25): the `h1` and the
// subtitle, in the markup each page always had. A page's `slots.Header`
// replaces it. Slice-internal.

import type { ReactElement } from 'react';
import { Typography } from '@mui/material';

import type { PageHeaderSlotProps } from '../../core/index.js';

/** What the default header takes: the slot's props plus the subtitle's bottom margin the page always used. */
export interface DefaultPageHeaderProps extends PageHeaderSlotProps {
  /** The subtitle's `mb` (the spacing step the page had before it took slots). */
  descriptionMarginBottom?: number;
}

/**
 * The `h1` and the subtitle. It ignores `readOnly` and `actions`: the identity
 * pages never printed a read-only note in their header, and a custom header
 * that wants one reads them.
 */
export function DefaultPageHeader({ title, description, descriptionMarginBottom = 2 }: DefaultPageHeaderProps): ReactElement {
  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: descriptionMarginBottom }}>
        {description}
      </Typography>
    </>
  );
}
