import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCli } from '@marinoscar/platform-cli';
import { listInstallSteps, listModelArtifacts, modelArtifactPath, pullModels, verifyModels, withheldTypesFor } from '@marinoscar/platform-cli/node';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { declareOcrModel } from './model.artifact.js';

let dir: string;

beforeEach(() => {
  resetCliForTests();
  createCli(APP_CLI_OPTIONS);
  dir = mkdtempSync(join(tmpdir(), 'example-model-'));
});
afterEach(() => {
  resetCliForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('declareOcrModel', () => {
  it('registers the file under its subdirectory and adds the models install step', () => {
    declareOcrModel();

    const [model] = listModelArtifacts();
    expect(model).toMatchObject({ id: 'ocr-eng', targetSubdir: 'tessdata', requiredBy: ['example.ocr'] });
    expect(modelArtifactPath(model as NonNullable<typeof model>, dir)).toBe(join(dir, 'tessdata', 'eng.traineddata'));
    expect(listInstallSteps().map((step) => step.id)).toContain('models');
  });

  it('withholds example.ocr while the file is missing and releases it once the file verifies', async () => {
    const content = Buffer.from('language data');
    declareOcrModel();
    // The example's digest is a placeholder, so verify against a declaration for real bytes.
    const real = { ...(listModelArtifacts()[0] as NonNullable<ReturnType<typeof listModelArtifacts>[number]>), sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length };

    expect([...withheldTypesFor(await verifyModels(dir, [real]), [real]).keys()]).toEqual(['example.ocr']);

    mkdirSync(join(dir, 'tessdata'), { recursive: true });
    writeFileSync(modelArtifactPath(real, dir), content);
    expect([...withheldTypesFor(await verifyModels(dir, [real]), [real]).keys()]).toEqual([]);
  });

  it('pull reports a failed download for the unreachable example host without throwing', async () => {
    declareOcrModel('http://127.0.0.1:1/never');

    const results = await pullModels({ modelsDir: dir, attempts: 1, sleep: async () => {} });

    expect(results).toEqual([expect.objectContaining({ id: 'ocr-eng', outcome: 'failed' })]);
  });
});
