// Type declarations for the small set of scripts/rename.mjs exports consumed
// from TypeScript (apps/cli/src/template-identity.test.ts). rename.mjs stays
// plain, unbuilt JavaScript on purpose — this file exists only so that
// consumer gets real types instead of `any`, without turning the script
// itself into a build target.

export interface Identity {
  productName: string;
  tagline: string;
  repoSlug: string;
  themeColor: string;
  backgroundColor: string;
}

export interface DerivedIdentity extends Identity {
  slug: string;
  serviceName: string;
  testDb: string;
  testContainer: string;
  repoUrl: string;
  rawUrl: string;
  cloneUrl: string;
  repoName: string;
  cliName: string | null;
}

export interface Edit {
  file: string;
  find: string;
  replace: string;
  expectedHits: number;
  why: string;
}

export function slugify(name: string): string;

export function derive(identity: Identity, cliName: string | null): DerivedIdentity;

export function buildPlan(old: DerivedIdentity, next: DerivedIdentity): Edit[];
