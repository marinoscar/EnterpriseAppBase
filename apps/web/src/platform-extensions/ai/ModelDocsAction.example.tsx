/**
 * Reference example (PP-14.24): an app adds a per-model action to the packaged
 * AI Models page through `slots.RowActions`, with no package edit.
 *
 * The slot receives the catalogue row the page holds. It is drawn in an extra
 * "More actions" column; the page's own Enabled switch and "Edit capabilities"
 * action are untouched, and `ai_config:write` still decides who may use them.
 *
 * Wire it where the route renders the page:
 * `<AiModelsPage slots={{ RowActions: ModelDocsAction }} />`.
 */
import type { ReactElement } from 'react';
import { Link } from '@mui/material';
import type { AiModel } from '@marinoscar/platform-web/ai/headless';

export function ModelDocsAction({ row }: { row: AiModel }): ReactElement {
  return (
    <Link href={`https://docs.example.com/models/${encodeURIComponent(row.modelId)}`} target="_blank" rel="noopener noreferrer">
      {`Docs for ${row.modelId}`}
    </Link>
  );
}
