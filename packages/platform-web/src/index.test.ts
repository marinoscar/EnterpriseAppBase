import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { PLATFORM_PACKAGE } from './index.js';

describe('@marinoscar/platform-web', () => {
  it('exports its package name', () => {
    expect(PLATFORM_PACKAGE).toBe('@marinoscar/platform-web');
  });

  it('renders under jsdom with Testing Library', () => {
    render(createElement('span', null, PLATFORM_PACKAGE));
    expect(screen.getByText('@marinoscar/platform-web')).toBeTruthy();
  });
});
