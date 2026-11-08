import { afterEach, describe, expect, it } from 'vitest';

import {
  freezeTuiAppRegistries,
  listTuiSelections,
  listTuiStateLoaders,
  registerTuiSelection,
  registerTuiStateLoader,
  resetTuiAppRegistriesForTests,
} from './app-registry.js';

afterEach(() => resetTuiAppRegistriesForTests());

const project = { id: 'project', label: 'Project', load: async () => ['Alpha'], display: (name: string) => name };

describe('registerTuiSelection', () => {
  it('lists selections in registration order', () => {
    registerTuiSelection(project);
    registerTuiSelection({ ...project, id: 'region', label: 'Region' });
    expect(listTuiSelections().map((entry) => entry.id)).toEqual(['project', 'region']);
  });

  it('rejects a malformed or duplicate id, a missing label or function, and a bad persist', () => {
    expect(() => registerTuiSelection({ ...project, id: 'Project' })).toThrow(/invalid/);
    expect(() => registerTuiSelection({ ...project, label: ' ' })).toThrow(/label/);
    expect(() => registerTuiSelection({ ...project, load: undefined as never })).toThrow(/load and display/);
    expect(() => registerTuiSelection({ ...project, persist: 'server' as never })).toThrow(/persist/);
    registerTuiSelection(project);
    expect(() => registerTuiSelection(project)).toThrow(/already registered/);
  });

  it('refuses registration after the CLI is built', () => {
    freezeTuiAppRegistries('createCli');
    expect(() => registerTuiSelection(project)).toThrow(/after createCli/);
    expect(() => registerTuiStateLoader({ id: 'info', load: async () => 1 })).toThrow(/after createCli/);
  });
});

describe('registerTuiStateLoader', () => {
  it('lists loaders and rejects duplicates and malformed ids', () => {
    registerTuiStateLoader({ id: 'update-info', load: async () => 1 });
    expect(listTuiStateLoaders().map((entry) => entry.id)).toEqual(['update-info']);
    expect(() => registerTuiStateLoader({ id: 'update-info', load: async () => 2 })).toThrow(/already registered/);
    expect(() => registerTuiStateLoader({ id: 'Bad Id', load: async () => 2 })).toThrow(/invalid/);
    expect(() => registerTuiStateLoader({ id: 'ok', load: undefined as never })).toThrow(/load function/);
  });
});
