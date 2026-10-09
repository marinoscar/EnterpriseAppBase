import { RetentionPurgeRegistry } from './retention-purge.registry';

describe('RetentionPurgeRegistry', () => {
  let registry: RetentionPurgeRegistry;

  beforeEach(() => {
    registry = new RetentionPurgeRegistry();
  });

  it('starts empty', () => {
    expect(registry.list()).toEqual([]);
  });

  it('replaces an entry registered twice for one policy (the last registration wins)', () => {
    registry.register({ policy: 'aiRuns', type: 'ai.runs.purge', what: 'AI run purge' });
    registry.register({ policy: 'aiRuns', type: 'ai.runs.purge.v2', what: 'AI run purge' });

    expect(registry.list()).toEqual([{ policy: 'aiRuns', type: 'ai.runs.purge.v2', what: 'AI run purge' }]);
  });

  it('refuses a policy that is not a retention namespace key', () => {
    expect(() => registry.register({ policy: 'nope' as never, type: 'x.purge', what: 'x' })).toThrow(
      /not a retention policy key/,
    );
  });

  it('refuses an empty type or phrase', () => {
    expect(() => registry.register({ policy: 'aiRuns', type: ' ', what: 'x' })).toThrow(/non-empty/);
    expect(() => registry.register({ policy: 'aiRuns', type: 'x', what: '' })).toThrow(/non-empty/);
  });

  it('returns copies, so a caller cannot edit the registered entry', () => {
    registry.register({ policy: 'aiRuns', type: 'ai.runs.purge', what: 'AI run purge' });

    registry.list()[0].type = 'tampered';

    expect(registry.list()[0].type).toBe('ai.runs.purge');
  });
});
