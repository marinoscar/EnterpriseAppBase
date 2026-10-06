// The Doctor's status colours come from the theme-token contract
// `palette.status.{ok,warn,crit,neutral}` (issue #686, PP-1.15): packages own
// structure, apps own appearance. An app restyles the Doctor by setting those
// tokens in its theme; a theme that sets none falls back to the MUI palette
// roles the tokens default to, so it looks as it always did. Not exported.

import type { Theme } from '@mui/material/styles';

import type { DoctorStatus } from '../headless/index.js';

type StatusToken = 'ok' | 'warn' | 'crit' | 'neutral';

const TOKEN_OF: Record<DoctorStatus, StatusToken> = {
  pass: 'ok',
  warn: 'warn',
  fail: 'crit',
  skip: 'neutral',
};

/** The colour of `status` in `theme`: its `palette.status` token, else the token's default. */
export function statusColor(theme: Theme, status: DoctorStatus): string {
  const token = TOKEN_OF[status];
  const own = (theme.palette as unknown as { status?: Partial<Record<StatusToken, unknown>> }).status?.[token];
  if (typeof own === 'string' && own !== '') return own;

  switch (token) {
    case 'ok':
      return theme.palette.success.main;
    case 'warn':
      return theme.palette.warning.main;
    case 'crit':
      return theme.palette.error.main;
    default:
      return theme.palette.grey[500];
  }
}
