import 'reflect-metadata';

import { Injectable, type CanActivate } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ApiProperty } from '@nestjs/swagger';
/** `@nestjs/swagger`'s own metadata key for the list of declared properties. */
const API_MODEL_PROPERTIES_ARRAY = 'swagger/apiModelPropertiesArray';
import {
  currentUserSchema,
  deviceActivateResponseSchema,
  deviceAuthorizeResponseSchema,
  deviceCodeResponseSchema,
  deviceSessionSchema,
  deviceTokenErrorSchema,
  deviceTokenResponseSchema,
  patCreatedResponseSchema,
  patListItemSchema,
  tokenResponseSchema,
  authProvidersResponseSchema,
} from '@marinoscar/platform-contract/identity';
import type { ZodObject } from 'zod';

import { withTemporaryEntries } from '../../src/core/index';
import {
  IDENTITY_EVENTS,
  IDENTITY_PERMISSION_DECLARATIONS,
  IDENTITY_ROLES,
  authProviderRegistry,
  registerAuthProvider,
} from '../../src/identity/index';
import { emitIdentityEvent } from '../../src/identity/identity.events';
import { CurrentUserDto, TokenResponseDto } from '../../src/identity/auth/dto/auth-user.dto';
import { AuthProvidersResponseDto } from '../../src/identity/auth/dto/auth-provider.dto';
import { PatCreatedResponseDto, PatListItemDto } from '../../src/identity/pat/dto/pat-response.dto';
import {
  DeviceActivateResponseDto,
  DeviceAuthorizeResponseDto,
  DeviceCodeResponseDto,
  DeviceSessionDto,
  DeviceTokenErrorDto,
  DeviceTokenResponseDto,
} from '../../src/identity/device-auth/dto';

// =============================================================================
// Identity's extension points and its contract parity (#727)
// =============================================================================

describe('registerAuthProvider (rung 2)', () => {
  @Injectable()
  class GithubStrategy {}
  class GithubGuard implements CanActivate {
    canActivate(): boolean {
      return true;
    }
  }

  it('registers Google first, and an app provider after it', async () => {
    expect(authProviderRegistry.ids()[0]).toBe('google');
    const github = { id: 'github', strategy: GithubStrategy, guard: GithubGuard, isEnabled: () => true };
    await withTemporaryEntries(authProviderRegistry, [github], () => {
      expect(authProviderRegistry.ids()).toEqual(['google', 'github']);
    });
    expect(authProviderRegistry.has('github')).toBe(false);
  });

  it('refuses a duplicate id, a bad id and a provider without its parts', () => {
    const google = authProviderRegistry.require('google');
    expect(() => registerAuthProvider(google)).toThrow(/google/);
    expect(() => registerAuthProvider({ ...google, id: 'Not Valid' })).toThrow();
    expect(() => registerAuthProvider({ ...google, id: 'nostrategy', strategy: undefined as never })).toThrow(/strategy/);
  });

  it('enables Google exactly when its client id and secret are configured', () => {
    const google = authProviderRegistry.require('google');
    const config = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;
    expect(google.isEnabled(config({ 'google.clientId': 'a', 'google.clientSecret': 'b' }))).toBe(true);
    expect(google.isEnabled(config({ 'google.clientId': 'a' }))).toBe(false);
  });
});

describe('identity events (rung 4)', () => {
  it('names the three events', () => {
    expect(IDENTITY_EVENTS).toEqual({
      USER_CREATED: 'identity.user.created',
      MEMBERSHIP_CHANGED: 'identity.membership.changed',
      ORG_SWITCHED: 'identity.org.switched',
    });
  });

  it('never lets a throwing listener fail the operation, and is a no-op without an emitter', () => {
    const warn = jest.fn();
    const emitter = {
      emit: () => {
        throw new Error('listener broke');
      },
    };
    expect(() => emitIdentityEvent(emitter, { warn }, IDENTITY_EVENTS.ORG_SWITCHED, { userId: 'u', orgId: 'o' })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('listener broke'));
    expect(() => emitIdentityEvent(undefined, { warn }, IDENTITY_EVENTS.ORG_SWITCHED, { userId: 'u', orgId: 'o' })).not.toThrow();
  });
});

describe('roles and permissions as data', () => {
  it('declares one system role and three org roles, in seed order', () => {
    expect(Object.values(IDENTITY_ROLES).map((role) => `${role.id}:${role.scope}`)).toEqual([
      'admin:system',
      'contributor:org',
      'viewer:org',
      'org_admin:org',
    ]);
  });

  it('grants every permission only to roles of its own scope', () => {
    const scopes = new Map(Object.values(IDENTITY_ROLES).map((role) => [role.id, role.scope]));
    for (const permission of Object.values(IDENTITY_PERMISSION_DECLARATIONS)) {
      for (const role of permission.defaultGrants) expect(`${permission.id} -> ${role}:${scopes.get(role)}`).toBe(`${permission.id} -> ${role}:${permission.scope}`);
    }
  });
});

/** The property names an `@ApiProperty` class declares, as @nestjs/swagger records them. */
function apiPropertiesOf(dto: abstract new (...args: never[]) => unknown): string[] {
  const names = (Reflect.getMetadata(API_MODEL_PROPERTIES_ARRAY, dto.prototype) ?? []) as string[];
  return names.map((name) => name.replace(/^:/, '')).sort();
}

describe('contract parity: each @ApiProperty response class declares its contract schema fields', () => {
  it.each([
    ['CurrentUserDto', CurrentUserDto, currentUserSchema],
    ['TokenResponseDto', TokenResponseDto, tokenResponseSchema],
    ['AuthProvidersResponseDto', AuthProvidersResponseDto, authProvidersResponseSchema],
    ['PatCreatedResponseDto', PatCreatedResponseDto, patCreatedResponseSchema],
    ['PatListItemDto', PatListItemDto, patListItemSchema],
    ['DeviceCodeResponseDto', DeviceCodeResponseDto, deviceCodeResponseSchema],
    ['DeviceTokenResponseDto', DeviceTokenResponseDto, deviceTokenResponseSchema],
    ['DeviceTokenErrorDto', DeviceTokenErrorDto, deviceTokenErrorSchema],
    ['DeviceAuthorizeResponseDto', DeviceAuthorizeResponseDto, deviceAuthorizeResponseSchema],
    ['DeviceActivateResponseDto', DeviceActivateResponseDto, deviceActivateResponseSchema],
    ['DeviceSessionDto', DeviceSessionDto, deviceSessionSchema],
  ] as const)('%s', (_name, dto, schema) => {
    expect(apiPropertiesOf(dto)).toEqual(Object.keys((schema as ZodObject).shape).sort());
  });

  it('reads the swagger metadata (guards against a vacuous comparison)', () => {
    class Probe {
      @ApiProperty() a!: string;
    }
    expect(apiPropertiesOf(Probe)).toEqual(['a']);
  });
});
