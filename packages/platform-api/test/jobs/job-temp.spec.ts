// =============================================================================
// Unit tests for the job temp-file naming (issue #263, epic #254)
// =============================================================================
//
// Two properties, and both of them are safety properties for the janitor
// rather than cosmetics: the prefix is DERIVED from the rebrandable app name
// (so two applications built from this template on one host cannot sweep each
// other's in-flight files), and it is never empty (so `startsWith` cannot
// match every file in `/tmp`).
// =============================================================================

import { promises as fs } from 'node:fs';

import * as jobTemp from '../../src/jobs/job-temp';
import { configureJobTempPrefix, jobTempDir, jobTempPath, jobTempPrefixFor } from '../../src/jobs/job-temp';

// A live binding (#734): the app configures its name through
// `JobsModule.forRoot({ appName })`, so read it through the module object.
const prefix = (): string => jobTemp.JOB_TEMP_PREFIX;

describe('JOB_TEMP_PREFIX', () => {
  afterEach(() => configureJobTempPrefix(''));

  it('is derived from the rebrandable app name, not written out', () => {
    configureJobTempPrefix('My Fancy App');

    expect(prefix()).toBe('my-fancy-app-job-');
  });

  it('is the neutral prefix before the app configures its name, and for a name that slugifies to nothing', () => {
    expect(prefix()).toBe('app-job-');
    expect(jobTempPrefixFor('!!!')).toBe('app-job-');
    expect(jobTempPrefixFor(undefined)).toBe('app-job-');
  });

  it('is never empty, so the janitor can never match every file in the temp dir', () => {
    expect(prefix().length).toBeGreaterThan(0);
  });

  it('is filesystem-safe: lowercase letters, digits and dashes only', () => {
    configureJobTempPrefix('Ünïcode & Spaces 2');
    expect(prefix()).toMatch(/^[a-z0-9-]+-$/);
  });
});

describe('jobTempPath', () => {
  it('puts a prefixed, unique name inside the temp directory', () => {
    const first = jobTempPath();
    const second = jobTempPath();

    expect(first.startsWith(`${jobTempDir()}/${prefix()}`)).toBe(true);
    expect(first).not.toBe(second);
  });

  it('appends a suffix for tools that insist on a real extension', () => {
    expect(jobTempPath('.pdf').endsWith('.pdf')).toBe(true);
  });

  it('creates nothing — it only returns a path', async () => {
    await expect(fs.access(jobTempPath())).rejects.toThrow();
  });
});
