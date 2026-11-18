// =============================================================================
// Mocked: the sharing-event listener of ./grant-events.example.ts is wired by
// `@OnEvent` and only records (issue #732)
// =============================================================================
//
// The slice emitting these events after a real commit is proven by
// ./user-owned-resource.example.db.spec.ts; here the app's half: a listener
// registered with `EventEmitterModule` receives `sharing.grant.*` by name,
// keeps a bounded record, and does nothing else.
// =============================================================================

import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { SHARING_EVENTS, type GrantEventPayload } from '@marinoscar/platform-api/sharing';

import { SharingActivityListener } from './grant-events.example';

const payload = (overrides: Partial<GrantEventPayload> = {}): GrantEventPayload => ({
  orgId: 'org-1',
  grantId: 'grant-1',
  resourceType: 'example_note',
  resourceId: 'note-1',
  granteeKind: 'user',
  granteeId: 'user-2',
  role: 'viewer',
  previousRole: null,
  actorUserId: 'user-1',
  ...overrides,
});

describe('SharingActivityListener (grant-events.example.ts)', () => {
  let listener: SharingActivityListener;
  let emitter: EventEmitter2;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EventEmitterModule.forRoot()], providers: [SharingActivityListener] }).compile();
    await moduleRef.init();
    listener = moduleRef.get(SharingActivityListener);
    emitter = moduleRef.get(EventEmitter2);
  });

  it('records created, updated and revoked grants by event name', () => {
    emitter.emit(SHARING_EVENTS.GRANT_CREATED, payload());
    emitter.emit(SHARING_EVENTS.GRANT_UPDATED, payload({ role: 'editor', previousRole: 'viewer' }));
    emitter.emit(SHARING_EVENTS.GRANT_REVOKED, payload({ role: 'editor' }));
    emitter.emit(SHARING_EVENTS.MEMBER_ADDED, { orgId: 'org-1', groupId: 'g', userId: 'u', role: 'viewer', previousRole: null, actorUserId: 'a' });
    expect(listener.recent).toEqual([
      { event: 'shared', resource: 'example_note:note-1', granteeKind: 'user', role: 'viewer', previousRole: null },
      { event: 'changed', resource: 'example_note:note-1', granteeKind: 'user', role: 'editor', previousRole: 'viewer' },
      { event: 'revoked', resource: 'example_note:note-1', granteeKind: 'user', role: 'editor', previousRole: null },
    ]);
  });

  it('keeps a bounded record', () => {
    for (let i = 0; i < SharingActivityListener.MAX + 5; i++) emitter.emit(SHARING_EVENTS.GRANT_CREATED, payload({ resourceId: `note-${i}` }));
    expect(listener.recent).toHaveLength(SharingActivityListener.MAX);
    expect(listener.recent[0]!.resource).toBe('example_note:note-5');
  });
});
