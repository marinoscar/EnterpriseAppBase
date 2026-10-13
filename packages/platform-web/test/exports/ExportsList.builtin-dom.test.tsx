/**
 * The exports list's markup with NO slot did not move (PP-14.20).
 *
 * `ExportsList` gained the `Columns` and `RowActions` slots. The snapshot beside
 * this file (`__snapshots__/`) was RECORDED FROM THE LIST AS IT WAS BEFORE THAT
 * CHANGE (the same fixtures, rendered by the old component), so passing means
 * the list a user sees with no slot passed is, element for element and class
 * for class, the one they had.
 *
 * The only normalisation is React's generated ids. Re-record only for a
 * deliberate change of the list.
 */
import { describe, expect, it } from 'vitest';

import { ExportsList } from '../../src/exports/ui/index.js';
import { ID, ORG_DATA, USER_DATA, hostWith, renderWith, view } from './fixtures.js';

function markup(root: HTMLElement): string {
  return root.innerHTML
    .replace(/_r_[0-9a-z]+_/g, '_r_N_')
    .replace(/:r[0-9a-z]+:/g, ':rN:')
    .replace(/></g, '>\n<');
}

const VIEWS = [
  view({ id: ID, status: 'ready', sizeBytes: 2048, createdAt: '2026-10-08T10:00:00.000Z' }),
  view({ id: 'b', source: 'org-data', scope: 'org', format: 'csv', status: 'failed', error: 'The file could not be built', createdAt: '2026-10-07T10:00:00.000Z' }),
  view({ id: 'c', status: 'pending', createdAt: '2026-10-06T10:00:00.000Z' }),
  view({ id: 'd', status: 'running', createdAt: '2026-10-05T10:00:00.000Z' }),
  view({ id: 'e', source: 'unknown-source', status: 'expired', createdAt: '2026-10-04T10:00:00.000Z' }),
];

describe('ExportsList builtin markup', () => {
  it('lists every status with its sources', () => {
    const { container } = renderWith(hostWith({}), <ExportsList exports={VIEWS} sources={[USER_DATA, ORG_DATA]} />);
    expect(markup(container)).toMatchSnapshot();
  });

  it('without sources falls back to the source id', () => {
    const { container } = renderWith(hostWith({}), <ExportsList exports={VIEWS.slice(0, 2)} />);
    expect(markup(container)).toMatchSnapshot();
  });

  it('is the empty message when there is nothing', () => {
    const { container } = renderWith(hostWith({}), <ExportsList exports={[]} />);
    expect(markup(container)).toMatchSnapshot();
  });
});
