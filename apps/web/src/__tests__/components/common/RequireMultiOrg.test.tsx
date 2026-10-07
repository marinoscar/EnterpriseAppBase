/**
 * `RequireMultiOrg` (#726): the feature half of an org-administration route's
 * gate. Multi-org mode renders the page; single-org mode (or no user) falls
 * back like a feature-off AI page.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { render, mockAdminUser } from '../../utils/test-utils';
import { RequireMultiOrg } from '../../../components/common/RequireMultiOrg';

function tree() {
  return (
    <Routes>
      <Route path="/" element={<div>home</div>} />
      <Route
        path="/admin/settings/organization"
        element={
          <RequireMultiOrg>
            <div>org page</div>
          </RequireMultiOrg>
        }
      />
    </Routes>
  );
}

describe('RequireMultiOrg (#726)', () => {
  it('renders the page in multi-org mode', () => {
    render(tree(), { wrapperOptions: { route: '/admin/settings/organization', user: { ...mockAdminUser, tenancyMode: 'multi' } } });
    expect(screen.getByText('org page')).toBeInTheDocument();
  });

  it.each([['single' as const], [undefined]])('redirects home when tenancyMode is %s', (tenancyMode) => {
    render(tree(), { wrapperOptions: { route: '/admin/settings/organization', user: { ...mockAdminUser, tenancyMode } } });
    expect(screen.queryByText('org page')).not.toBeInTheDocument();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('renders a custom fallback', () => {
    render(
      <RequireMultiOrg fallback={<div>not here</div>}>
        <div>org page</div>
      </RequireMultiOrg>,
      { wrapperOptions: { user: { ...mockAdminUser, tenancyMode: 'single' } } },
    );
    expect(screen.getByText('not here')).toBeInTheDocument();
  });
});
