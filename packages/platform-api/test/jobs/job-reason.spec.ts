// =============================================================================
// The job reason registry (PP-14.19): an open vocabulary, strict on write
// =============================================================================

import { JOB_REASON_PATTERN } from '@marinoscar/platform-contract/jobs';

import {
  assertJobReason,
  isJobReason,
  jobReasonLabel,
  jobReasonRegistry,
  listJobReasons,
  registerJobReason,
} from '../../src/jobs/job-reason';

describe('job reasons', () => {
  it("registers the platform's three first, through the same function an app uses", () => {
    expect(listJobReasons().slice(0, 3)).toEqual([
      { id: 'upload', label: 'Upload' },
      { id: 'rerun', label: 'Rerun' },
      { id: 'backfill', label: 'Backfill' },
    ]);
  });

  it('accepts an app reason once registered, and labels it', () => {
    expect(isJobReason('import')).toBe(false);
    expect(() => assertJobReason('import')).toThrow(/Unknown job reason "import".*registerJobReason/s);

    registerJobReason({ id: 'import', label: 'Bulk import' });

    expect(isJobReason('import')).toBe(true);
    expect(() => assertJobReason('import')).not.toThrow();
    expect(jobReasonLabel('import')).toBe('Bulk import');
  });

  it('names the registered ids when a reason is unknown, so a typo is obvious', () => {
    expect(() => assertJobReason('uplaod')).toThrow(/upload, rerun, backfill/);
  });

  it('labels an unregistered stored reason with its id (reading never rejects)', () => {
    expect(jobReasonLabel('removed-plugin')).toBe('removed-plugin');
    expect(jobReasonLabel('')).toBe('');
  });

  it('refuses a repeat id, a bad id and a bad label', () => {
    registerJobReason({ id: 'sync-all', label: 'Sync everything' });
    expect(() => registerJobReason({ id: 'sync-all', label: 'Again' })).toThrow(/already registered/);
    for (const id of ['', 'x', 'Upload', '1abc', 'has space', 'a'.repeat(49), "x'; drop table jobs;--"]) {
      expect(() => registerJobReason({ id, label: 'Label' })).toThrow();
    }
    expect(() => registerJobReason({ id: 'no-label', label: ' ' })).toThrow(/label/);
    expect(() => registerJobReason({ id: 'long-label', label: 'x'.repeat(65) })).toThrow(/at most 64/);
  });

  it('uses the contract pattern for ids, so the wire and the registry cannot disagree', () => {
    for (const { id } of listJobReasons()) expect(JOB_REASON_PATTERN.test(id)).toBe(true);
    expect(jobReasonRegistry.name).toBe('job-reasons');
  });
});
