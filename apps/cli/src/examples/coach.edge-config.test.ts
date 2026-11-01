import { createCli } from '@marinoscar/platform-cli';
import { edgeConfigFiles } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { coachRateLimits } from './coach.edge-config.js';

// The registerEdgeConfigFile example (PP-14.22).

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

describe('coachRateLimits', () => {
  it('is not checked by the shipped CLI, which compares nginx.conf and csp.conf', () => {
    createCli(APP_CLI_OPTIONS);
    expect(edgeConfigFiles().map((file) => file.container)).toEqual(['/etc/nginx/nginx.conf', '/etc/nginx/csp.conf']);
  });

  it('joins the stale-inode comparison once passed in edgeConfigFiles', () => {
    createCli({ ...APP_CLI_OPTIONS, edgeConfigFiles: [coachRateLimits] });
    expect(edgeConfigFiles().at(-1)).toEqual(coachRateLimits);
  });

  it('refuses a path outside the checkout and one the platform already checks', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, edgeConfigFiles: [{ ...coachRateLimits, checkout: '../outside.conf' }] })).toThrow(/relative to the checkout root/);
    resetCliForTests();
    expect(() => createCli({ ...APP_CLI_OPTIONS, edgeConfigFiles: [{ checkout: 'infra/x.conf', container: '/etc/nginx/csp.conf' }] })).toThrow(/already checked/);
  });
});
