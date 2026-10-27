// The jobs slice's registry entries (issue #854): the three Operations cards,
// in the reference app's order, with the exact permission strings the
// packaged controllers enforce, and titles the pages render as their `h1`.

import { describe, expect, it } from 'vitest';

import { jobsAdminSections } from '../../src/jobs/ui/index.js';

describe('jobsAdminSections', () => {
  it('declares Jobs, Job Insights and Worker Nodes, in that order', () => {
    expect(jobsAdminSections.operations.map((card) => [card.title, card.path, card.permission])).toEqual([
      ['Jobs', '/admin/settings/jobs', 'jobs:read'],
      ['Job Insights', '/admin/settings/jobs/insights', 'jobs:read'],
      ['Worker Nodes', '/admin/settings/workers', 'nodes:read'],
    ]);
  });

  it('carries no feature gate and an icon per card', () => {
    for (const card of jobsAdminSections.operations) {
      expect(card.feature).toBeUndefined();
      expect(card.Icon).toBeTruthy();
      expect(card.description.length).toBeGreaterThan(0);
    }
  });

  it('is frozen data', () => {
    expect(Object.isFrozen(jobsAdminSections)).toBe(true);
    expect(Object.isFrozen(jobsAdminSections.operations)).toBe(true);
  });
});
