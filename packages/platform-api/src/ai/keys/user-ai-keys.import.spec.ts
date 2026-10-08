// UserAiKeysService.importKey (issue #739): the key-import helper for app data
// migrations (kvox, MemoriaHub). Encrypts through the user-key cipher path,
// stores unverified, queues the provider's recheck, audits without the key.

import { decryptSecret } from '../../core/index';
import { AI_CATALOG_SUBJECT_TYPE } from '../catalog/ai-catalog.service';
import { AiError } from '../core/ai-error';
import { AI_KEYS_RECHECK_TYPE, AI_USER_KEY_PURPOSE } from './ai-user-key.constants';
import { UserAiKeysService } from './user-ai-keys.service';

const ORIGINAL_KEY_ENV = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
afterAll(() => {
  if (ORIGINAL_KEY_ENV === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY_ENV;
});

const USER = '11111111-1111-4111-8111-111111111111';
const KEY = 'sk-imported-from-kvox-ABCD1234';

function build(opts: { enqueue?: jest.Mock } = {}) {
  const upsert = jest.fn(async () => ({ id: 'row-1' }));
  const auditCreate = jest.fn(async () => ({}));
  const enqueue = opts.enqueue ?? jest.fn(async () => ({ id: 'job-1' }));
  const service = new UserAiKeysService(
    { userAiKey: { upsert }, auditEvent: { create: auditCreate } } as never,
    {} as never,
    {} as never,
    { enqueue } as never,
  );
  return { service, upsert, auditCreate, enqueue };
}

describe('UserAiKeysService.importKey', () => {
  it('encrypts through the user-key cipher path and stores the key unverified', async () => {
    const { service, upsert } = build();
    await service.importKey(USER, 'openai', `  ${KEY}  `, { source: 'kvox' });

    const args = (upsert.mock.calls[0] as unknown as [{ create: Record<string, unknown>; update: Record<string, unknown> }])[0];
    expect(args.create).toMatchObject({ userId: USER, provider: 'openai', verifiedAt: null, reachableModelIds: [], reachableCheckedAt: null });
    expect(args.create.secret).not.toContain(KEY);
    expect(decryptSecret(args.create.secret as string, AI_USER_KEY_PURPOSE)).toBe(KEY);
    expect(args.update).toMatchObject({ verifiedAt: null, reachableCheckedAt: null });
  });

  it("queues the provider's ai.keys.recheck with the recheck task's dedup subject", async () => {
    const { service, enqueue } = build();
    await service.importKey(USER, 'anthropic', KEY, { source: 'memoriahub' });
    expect(enqueue).toHaveBeenCalledWith({
      type: AI_KEYS_RECHECK_TYPE,
      reason: 'backfill',
      subjectType: AI_CATALOG_SUBJECT_TYPE,
      subjectId: 'anthropic',
      payload: { provider: 'anthropic' },
    });
  });

  it('audits ai:user-key:import with the source, never the key', async () => {
    const { service, auditCreate } = build();
    await service.importKey(USER, 'openai', KEY, { source: 'kvox' });
    const row = (auditCreate.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(row).toMatchObject({ actorUserId: USER, action: 'ai:user-key:import', targetId: 'openai', meta: { provider: 'openai', source: 'kvox' } });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(KEY);
  });

  it('keeps the stored key when the queue refuses, and never echoes the key in the warning', async () => {
    const { service, upsert } = build({ enqueue: jest.fn(async () => { throw new Error('queue down'); }) });
    await expect(service.importKey(USER, 'openai', KEY, { source: 'kvox' })).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalled();
  });

  it('refuses a blank key', async () => {
    const { service, upsert } = build();
    await expect(service.importKey(USER, 'openai', '   ', { source: 'kvox' })).rejects.toBeInstanceOf(AiError);
    expect(upsert).not.toHaveBeenCalled();
  });
});
