import { supportBundleSchema } from '@marinoscar/platform-contract/doctor';
import { z } from 'zod';

import type { ResolvedDoctorModuleOptions } from '../../../src/doctor/doctor.options';
import { omitSupportBundleSection } from '../../../src/doctor/support-bundle/support-bundle-section.interface';
import type { SupportBundleSection } from '../../../src/doctor/support-bundle/support-bundle-section.interface';
import {
  SUPPORT_BUNDLE_MAX_BYTES,
  SUPPORT_BUNDLE_SECTION_MAX_BYTES,
  defaultSupportBundlePrincipal,
} from '../../../src/doctor/support-bundle/support-bundle.options';
import { SupportBundleRegistry } from '../../../src/doctor/support-bundle/support-bundle.registry';
import { SupportBundleService } from '../../../src/doctor/support-bundle/support-bundle.service';
import { InMemoryAuditSink } from '../../../src/testing';

const ACTOR = { userId: 'user-42', permissions: ['system_settings:read'] };
const NOW = new Date('2026-10-06T09:08:07.654Z');

function options(sectionTimeoutMs = 200): ResolvedDoctorModuleOptions {
  return {
    supportBundle: { enabled: true, appSlug: 'my-app', principal: defaultSupportBundlePrincipal, sectionTimeoutMs },
  } as unknown as ResolvedDoctorModuleOptions;
}

function section<T>(id: string, collect: SupportBundleSection<T>['collect'], schema: z.ZodType<T>, extra: Partial<SupportBundleSection<T>> = {}) {
  return { id, label: id, schema, collect, ...extra } as SupportBundleSection;
}

const okSchema = z.object({ value: z.string() }).strict();

function setup(sections: SupportBundleSection[], audit: InMemoryAuditSink | undefined = new InMemoryAuditSink(), timeout = 200) {
  const registry = new SupportBundleRegistry();
  for (const s of sections) registry.register(s);
  return { service: new SupportBundleService(registry, options(timeout), audit), audit };
}

describe('SupportBundleService', () => {
  it('builds a bundle that parses with the contract schema, named support-bundle-<slug>-<UTC stamp>.json', async () => {
    const { service } = setup([section('alpha', async () => ({ value: 'a' }), okSchema)]);

    const built = await service.build(ACTOR, NOW);
    const parsed = supportBundleSchema.parse(JSON.parse(built.body.toString('utf8')));

    expect(built.filename).toBe('support-bundle-my-app-20261006T090807Z.json');
    expect(parsed).toEqual({
      bundleVersion: 1,
      generatedAt: NOW.toISOString(),
      redaction: { rules: 'v1', replacements: 0 },
      sections: { alpha: { status: 'ok', data: { value: 'a' } } },
    });
    expect(built.body.toString('utf8')).toContain('\n  "bundleVersion": 1'); // pretty-printed
    expect(built.meta).toMatchObject({ sections: { alpha: 'ok' }, bytes: built.body.length, replacements: 0 });
  });

  it('never writes the actor into the bundle', async () => {
    const { service } = setup([section('alpha', async ({ actorUserId }) => ({ value: `for ${actorUserId.length}` }), okSchema)]);

    const built = await service.build(ACTOR, NOW);

    expect(built.body.toString('utf8')).not.toContain('user-42');
  });

  it('runs sections in parallel', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const waiting = (id: string) =>
      section(
        id,
        async () => {
          started.push(id);
          if (started.length === 2) release();
          await gate;
          return { value: id };
        },
        okSchema,
      );
    const { service } = setup([waiting('one'), waiting('two')], undefined, 1_000);

    const built = await service.build(ACTOR, NOW);

    expect(started.sort()).toEqual(['one', 'two']);
    expect(built.meta.sections).toEqual({ one: 'ok', two: 'ok' });
  });

  it('omits a section whose extra permission the caller lacks, without running it', async () => {
    const collect = jest.fn(async () => ({ value: 'x' }));
    const { service } = setup([section('telemetry', collect, okSchema, { permission: 'telemetry:query' })]);

    const built = await service.build(ACTOR, NOW);

    expect(built.bundle.sections.telemetry).toEqual({ status: 'omitted', reason: 'requires the telemetry:query permission' });
    expect(collect).not.toHaveBeenCalled();
  });

  it('runs it for a caller holding the permission, and honours an omission from collect()', async () => {
    const { service } = setup([
      section('telemetry', async () => ({ value: 'x' }), okSchema, { permission: 'telemetry:query' }),
      section('off', async () => omitSupportBundleSection('telemetry is switched off'), okSchema),
    ]);

    const built = await service.build({ ...ACTOR, permissions: [...ACTOR.permissions, 'telemetry:query'] }, NOW);

    expect(built.bundle.sections.telemetry).toEqual({ status: 'ok', data: { value: 'x' } });
    expect(built.bundle.sections.off).toEqual({ status: 'omitted', reason: 'telemetry is switched off' });
  });

  describe('fails closed per section, keeping the rest intact', () => {
    const healthy = section('healthy', async () => ({ value: 'fine' }), okSchema);

    it('a throw becomes one redacted line', async () => {
      const { service } = setup([
        section('boom', async () => {
          throw new Error('connect to 10.1.2.3 refused for ops@example.com\n    at stack line');
        }, okSchema),
        healthy,
      ]);

      const built = await service.build(ACTOR, NOW);

      expect(built.bundle.sections.boom).toEqual({ status: 'error', error: 'connect to [ip] refused for [email]' });
      expect(built.bundle.sections.healthy).toEqual({ status: 'ok', data: { value: 'fine' } });
      expect(built.bundle.redaction.replacements).toBe(2);
    });

    it('a timeout aborts the signal and reports the ceiling', async () => {
      let aborted = false;
      const { service } = setup([
        section(
          'slow',
          ({ signal }) =>
            new Promise((resolve) => {
              signal.addEventListener('abort', () => {
                aborted = true;
              });
              setTimeout(() => resolve({ value: 'late' }), 2_000).unref();
            }),
          okSchema,
          { timeoutMs: 30 },
        ),
        healthy,
      ]);

      const built = await service.build(ACTOR, NOW);

      expect(built.bundle.sections.slow).toEqual({ status: 'error', error: 'timed out after 30 ms' });
      expect(built.bundle.sections.healthy.status).toBe('ok');
      expect(aborted).toBe(true);
    });

    it('a field outside the strict schema drops the data', async () => {
      const { service } = setup([
        section('leaky', async () => ({ value: 'ok', hostname: 'db-01.internal' }) as never, okSchema),
        healthy,
      ]);

      const built = await service.build(ACTOR, NOW);

      expect(built.bundle.sections.leaky).toEqual({ status: 'error', error: 'section output did not match its schema' });
      expect(built.body.toString('utf8')).not.toContain('db-01.internal');
      expect(built.bundle.sections.healthy.status).toBe('ok');
    });
  });

  it('redacts every section centrally and counts the replacements', async () => {
    const { service } = setup([
      section('a', async () => ({ value: 'from 192.168.0.1' }), okSchema),
      section('b', async () => ({ token: 'abc', value: 'x' }), z.object({ token: z.string(), value: z.string() }).strict()),
    ]);

    const built = await service.build(ACTOR, NOW);

    expect(built.bundle.sections.a).toEqual({ status: 'ok', data: { value: 'from [ip]' } });
    expect(built.bundle.sections.b).toEqual({ status: 'ok', data: { token: '[redacted]', value: 'x' } });
    expect(built.bundle.redaction.replacements).toBe(2);
  });

  it('does not treat a section id as a sensitive key', async () => {
    const { service } = setup([section('credentials', async () => ({ value: 'count 3' }), okSchema)]);

    const built = await service.build(ACTOR, NOW);

    expect(built.bundle.sections.credentials).toEqual({ status: 'ok', data: { value: 'count 3' } });
  });

  describe('size caps', () => {
    const big = (id: string, bytes: number) =>
      section(id, async () => ({ value: 'x '.repeat(Math.ceil(bytes / 2)) }), okSchema, {});

    it('truncates a section over 512 KiB', async () => {
      const { service } = setup([big('huge', SUPPORT_BUNDLE_SECTION_MAX_BYTES + 10), big('small', 100)]);

      const built = await service.build(ACTOR, NOW);

      expect(built.bundle.sections.huge).toEqual({ status: 'ok', data: null, truncated: true });
      expect(built.bundle.sections.small.status).toBe('ok');
      expect((built.bundle.sections.small as { data: unknown }).data).not.toBeNull();
    });

    it('keeps the bundle under 2 MiB, truncating the largest sections first', async () => {
      const each = SUPPORT_BUNDLE_SECTION_MAX_BYTES - 4_096;
      const sections = ['a', 'b', 'c', 'd', 'e'].map((id, index) => big(id, each - index * 1_000));
      const { service } = setup(sections);

      const built = await service.build(ACTOR, NOW);

      expect(built.body.length).toBeLessThanOrEqual(SUPPORT_BUNDLE_MAX_BYTES);
      expect(built.bundle.sections.a).toEqual({ status: 'ok', data: null, truncated: true });
      expect((built.bundle.sections.e as { data: unknown }).data).not.toBeNull();
    });
  });

  describe('download()', () => {
    it('audits one support_bundle:download event with statuses, bytes and replacements, and no email', async () => {
      const { service, audit } = setup([
        section('a', async () => ({ value: 'mail ops@example.com' }), okSchema),
        section('t', async () => ({ value: 'x' }), okSchema, { permission: 'telemetry:query' }),
      ]);

      const built = await service.download(ACTOR);

      expect(audit!.events).toEqual([
        {
          action: 'support_bundle:download',
          actorUserId: 'user-42',
          targetType: 'deployment',
          targetId: 'support_bundle',
          meta: { sections: 'a=ok,t=omitted', bytes: built.body.length, replacements: 1 },
        },
      ]);
      expect(JSON.stringify(audit!.events)).not.toMatch(/@/);
    });

    it('still returns the bundle when the audit write fails', async () => {
      const audit = new InMemoryAuditSink();
      jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('database down'));
      const { service } = setup([section('a', async () => ({ value: 'x' }), okSchema)], audit);

      await expect(service.download(ACTOR)).resolves.toMatchObject({ meta: { sections: { a: 'ok' } } });
    });

    it('works without an audit sink', async () => {
      const registry = new SupportBundleRegistry();
      const service = new SupportBundleService(registry, options());

      await expect(service.download(ACTOR)).resolves.toMatchObject({ meta: { sections: {} } });
    });
  });
});

describe('defaultSupportBundlePrincipal', () => {
  it('reads requestUser, then user, when they carry an id and permissions', () => {
    expect(defaultSupportBundlePrincipal({ requestUser: { id: 'u1', permissions: ['a'] } })).toEqual({ userId: 'u1', permissions: ['a'] });
    expect(defaultSupportBundlePrincipal({ user: { id: 'u2', permissions: [] } })).toEqual({ userId: 'u2', permissions: [] });
  });

  it('returns null otherwise', () => {
    expect(defaultSupportBundlePrincipal(null)).toBeNull();
    expect(defaultSupportBundlePrincipal({})).toBeNull();
    expect(defaultSupportBundlePrincipal({ user: { id: 'u', userRoles: [] } })).toBeNull();
    expect(defaultSupportBundlePrincipal({ user: { id: 1, permissions: [] } })).toBeNull();
  });
});
