// The AI slice registers its own object-key prefix with the storage slice's
// registry (issue #739): `ai-outputs/`, user-scoped, owner `ai`.

import { storageKeyPrefixRegistry } from '../../storage/index';
import { AiModule } from '../ai.module';
import { AI_OUTPUTS_KEY_PREFIX, aiOutputKeyPrefix } from './ai-output-writer';
import { AI_STORAGE_KEY_PREFIXES, registerAiStorageKeyPrefixes } from './ai-storage-key-prefixes';

describe('AI_STORAGE_KEY_PREFIXES', () => {
  it('declares exactly ai-outputs/, owner ai, user scope', () => {
    expect(AI_STORAGE_KEY_PREFIXES).toEqual([
      expect.objectContaining({ id: 'ai-outputs', prefix: AI_OUTPUTS_KEY_PREFIX, owner: 'ai', scope: 'user' }),
    ]);
    expect(AI_OUTPUTS_KEY_PREFIX).toBe('ai-outputs/');
    expect(aiOutputKeyPrefix('u', 'r').startsWith(AI_OUTPUTS_KEY_PREFIX)).toBe(true);
  });

  it('is registered by AiModule.forRoot, and registering again is a no-op', () => {
    AiModule.forRoot();
    expect(storageKeyPrefixRegistry.get('ai-outputs')).toEqual(AI_STORAGE_KEY_PREFIXES[0]);

    const before = storageKeyPrefixRegistry.list().length;
    expect(() => registerAiStorageKeyPrefixes()).not.toThrow();
    AiModule.forRoot();
    expect(storageKeyPrefixRegistry.list()).toHaveLength(before);
  });
});
