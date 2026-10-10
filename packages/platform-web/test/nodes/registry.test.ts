// The nodes slice's registry entry (issue #881): the Worker Nodes card with the
// exact permission string `nodes-admin.controller.ts` enforces, and the same
// card at the end of the jobs slice's Operations list.

import { describe, expect, it } from 'vitest';

import { jobsAdminSections } from '../../src/jobs/ui/index.js';
import { nodesAdminSections } from '../../src/nodes/ui/index.js';

describe('nodesAdminSections', () => {
  it('declares Worker Nodes on nodes:read', () => {
    expect(nodesAdminSections.operations.map((card) => [card.title, card.path, card.permission])).toEqual([
      ['Worker Nodes', '/admin/settings/workers', 'nodes:read'],
    ]);
  });

  it('carries no feature gate and an icon', () => {
    for (const card of nodesAdminSections.operations) {
      expect(card.feature).toBeUndefined();
      expect(card.Icon).toBeTruthy();
      expect(card.description.length).toBeGreaterThan(0);
    }
  });

  it('is frozen data, and the jobs list ends with the very same card', () => {
    expect(Object.isFrozen(nodesAdminSections)).toBe(true);
    expect(Object.isFrozen(nodesAdminSections.operations)).toBe(true);
    expect(jobsAdminSections.operations.at(-1)).toBe(nodesAdminSections.operations[0]);
  });
});
