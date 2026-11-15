/**
 * Where the app lives inside its repository (issue #1159).
 *
 * The deploy engine keeps ONE git checkout per deployment, at
 * `<deployRoot>/repo`. An app that is the whole repository keeps `infra/`,
 * `apps/` and `.env` at that root; an app that lives in a subdirectory
 * (`console/`) keeps them at `<deployRoot>/repo/<appDir>`. This module is the
 * single source of truth for the difference:
 *
 * - GIT operations (clone, fetch, checkout, the version commit and push, the
 *   uninstall removal of the checkout) stay at the repository root.
 * - EVERYTHING THE APP OWNS (the compose directory, its `.env` and
 *   `.env.example`, the edge config files, the Android project) resolves
 *   through {@link appCheckoutPath} / {@link composeDirFor}.
 *
 * The default is `''` (the repository root), under which every path is
 * byte-for-byte what it was before the option existed.
 */
import { join } from 'node:path';

import { UsageError } from '../errors.js';

/** One path segment: no separators, no whitespace, no regex-hostile surprises. */
const SEGMENT = /^[A-Za-z0-9._@+-]+$/;

/**
 * Validates and normalises `deploy.appDir`.
 *
 * Accepts a plain relative POSIX path (`console`, `apps/x`); one trailing
 * slash is dropped (`console/` is `console`); `''` is the repository root.
 * Rejects a leading `/` or drive letter, a backslash, a `..` or `.` segment
 * and an empty segment (`a//b`): the value is joined onto the checkout path
 * and must never leave it.
 *
 * @param value - The candidate.
 * @returns the normalised directory, `''` for the repository root.
 * @throws UsageError naming the value and the rule it broke.
 * @internal
 */
export function normalizeAppDir(value: string): string {
  if (typeof value !== 'string') {
    throw new UsageError('deploy.appDir must be a string.');
  }
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value;
  if (trimmed === '') return '';
  const shown = JSON.stringify(value);
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) {
    throw new UsageError(`deploy.appDir ${shown} must be a path relative to the repository root.`);
  }
  if (trimmed.includes('\\')) {
    throw new UsageError(`deploy.appDir ${shown} must use "/" separators.`);
  }
  const segments = trimmed.split('/');
  if (segments.includes('..')) {
    throw new UsageError(`deploy.appDir ${shown} must not contain "..".`);
  }
  if (segments.some((segment) => segment === '.' || segment === '' || !SEGMENT.test(segment))) {
    throw new UsageError(`deploy.appDir ${shown} must be a plain relative path such as "console".`);
  }
  return trimmed;
}

let configuredAppDir = '';

/**
 * Sets the app directory for this process; `createCli` calls it with
 * `options.deploy?.appDir`. `undefined` restores the default (`''`).
 *
 * @throws UsageError on an invalid value; nothing is changed then.
 * @internal
 */
export function setAppDir(value: string | undefined): void {
  configuredAppDir = value === undefined ? '' : normalizeAppDir(value);
}

/** Restores the default. Tests only (`resetCliRegistriesForTests` calls it). */
export function resetAppDirForTests(): void {
  configuredAppDir = '';
}

/** The app directory in force, `''` for the repository root. @internal */
export function appDir(): string {
  return configuredAppDir;
}

/** The git checkout of a deployment: always `<deployRoot>/repo`, whatever the app directory. */
export function repoCheckoutPath(deployRoot: string): string {
  return join(deployRoot, 'repo');
}

/**
 * The app's directory inside the checkout: `<deployRoot>/repo/<appDir>`, which
 * is the checkout itself when the app is the whole repository.
 */
export function appCheckoutPath(deployRoot: string): string {
  const dir = appDir();
  return dir === '' ? repoCheckoutPath(deployRoot) : join(repoCheckoutPath(deployRoot), ...dir.split('/'));
}

/** The app's compose directory, `<appCheckoutPath>/infra/compose`. */
export function composeDirFor(deployRoot: string): string {
  return join(appCheckoutPath(deployRoot), 'infra', 'compose');
}
