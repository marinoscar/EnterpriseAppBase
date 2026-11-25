// The job-type label registry (#734): a handler's `label`, then a registered
// label, then the type itself. Replaces the closed `JOB_TYPE_LABELS` map.

import { Logger } from '@nestjs/common';

import { JobHandlerRegistry } from './job-handler.registry';
import type { JobHandler } from './job-handler.interface';
import { jobTypeLabel, jobTypeLabels, registerJobTypeLabel } from './job-type-label';

function handler(type: string, label?: string): JobHandler {
  return { type, ...(label === undefined ? {} : { label }), process: async () => undefined };
}

describe('jobTypeLabel', () => {
  it('falls back to the raw type string for an unlabelled type', () => {
    // The case a fork lives in until it labels its types: a dashboard cell
    // must not render blank.
    expect(jobTypeLabel('my-feature.do-the-thing')).toBe('my-feature.do-the-thing');
  });

  it('never returns an empty label for a non-empty type', () => {
    for (const type of ['a', 'spec.unknown', 'x.y.z']) {
      expect(jobTypeLabel(type).length).toBeGreaterThan(0);
    }
  });

  it("resolves a registered handler's own label", () => {
    new JobHandlerRegistry().register(handler('spec.with-label', 'Spec with label'));

    expect(jobTypeLabel('spec.with-label')).toBe('Spec with label');
  });

  it('resolves a label registered for a type whose handler is not loaded', () => {
    registerJobTypeLabel('spec.remote-only', 'Remote only');

    expect(jobTypeLabel('spec.remote-only')).toBe('Remote only');
  });

  it("prefers the handler's label over a registered one", () => {
    registerJobTypeLabel('spec.both', 'Registered');
    new JobHandlerRegistry().register(handler('spec.both', 'From the handler'));

    expect(jobTypeLabel('spec.both')).toBe('From the handler');
  });

  it('a handler without a label leaves a registered label in place', () => {
    registerJobTypeLabel('spec.fallback', 'Registered fallback');
    new JobHandlerRegistry().register(handler('spec.fallback'));

    expect(jobTypeLabel('spec.fallback')).toBe('Registered fallback');
  });

  it('the last registration wins, as in the handler registry', () => {
    const registry = new JobHandlerRegistry();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    registry.register(handler('spec.twice', 'First'));
    registry.register(handler('spec.twice', 'Second'));
    registerJobTypeLabel('spec.registered-twice', 'One');
    registerJobTypeLabel('spec.registered-twice', 'Two');

    expect(jobTypeLabel('spec.twice')).toBe('Second');
    expect(jobTypeLabel('spec.registered-twice')).toBe('Two');
  });

  it('refuses an empty type or label', () => {
    expect(() => registerJobTypeLabel('', 'Label')).toThrow(/type must be a non-empty string/);
    expect(() => registerJobTypeLabel('spec.empty', '  ')).toThrow(/label must be a non-empty string/);
  });

  it('lists every known label, handler labels over registered ones', () => {
    registerJobTypeLabel('spec.listed', 'Listed');

    const all = jobTypeLabels();

    expect(all.get('spec.listed')).toBe('Listed');
    expect(all.get('spec.both')).toBe('From the handler');
  });
});
