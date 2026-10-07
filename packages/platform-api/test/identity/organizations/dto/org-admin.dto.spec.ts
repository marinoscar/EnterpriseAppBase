import { createOrganizationSchema, renameOrganizationSchema } from '../../../../src/identity/organizations/dto/organization.dto';
import { updateOrgMemberSchema } from '../../../../src/identity/organizations/dto/org-member.dto';
import { createOrgInviteSchema } from '../../../../src/identity/organizations/dto/org-invite.dto';

describe('org administration DTOs (#726)', () => {
  describe('createOrganizationSchema', () => {
    const valid = { name: '  Acme Corp ', slug: 'acme-corp', firstAdminEmail: 'Boss@Acme.COM' };

    it('trims the name and lower-cases the first admin email', () => {
      expect(createOrganizationSchema.parse(valid)).toEqual({
        name: 'Acme Corp',
        slug: 'acme-corp',
        firstAdminEmail: 'boss@acme.com',
      });
    });

    it.each(['a', '-acme', 'acme-', 'ac me', 'acme_corp', 'x'.repeat(64)])('rejects the slug %p', (slug) => {
      expect(() => createOrganizationSchema.parse({ ...valid, slug })).toThrow();
    });

    it.each(['ab', 'acme', 'a1-b2', 'x'.repeat(63)])('accepts the slug %p', (slug) => {
      expect(createOrganizationSchema.parse({ ...valid, slug }).slug).toBe(slug);
    });

    it('rejects an unknown key, an empty name and a bad email', () => {
      expect(() => createOrganizationSchema.parse({ ...valid, isDefault: true })).toThrow();
      expect(() => createOrganizationSchema.parse({ ...valid, name: '   ' })).toThrow();
      expect(() => createOrganizationSchema.parse({ ...valid, firstAdminEmail: 'nope' })).toThrow();
    });
  });

  describe('renameOrganizationSchema', () => {
    it('accepts a name and refuses a slug change', () => {
      expect(renameOrganizationSchema.parse({ name: 'New' })).toEqual({ name: 'New' });
      expect(() => renameOrganizationSchema.parse({ name: 'New', slug: 'new' })).toThrow();
    });
  });

  describe('updateOrgMemberSchema', () => {
    it('accepts a role, a status or both, and nothing else', () => {
      expect(updateOrgMemberSchema.parse({ roleName: 'viewer' })).toEqual({ roleName: 'viewer' });
      expect(updateOrgMemberSchema.parse({ status: 'suspended' })).toEqual({ status: 'suspended' });
      expect(() => updateOrgMemberSchema.parse({})).toThrow();
      expect(() => updateOrgMemberSchema.parse({ roleName: 'admin' })).toThrow();
      expect(() => updateOrgMemberSchema.parse({ roleName: 'viewer', orgId: 'x' })).toThrow();
    });
  });

  describe('createOrgInviteSchema', () => {
    it('lower-cases the email and requires an org role', () => {
      expect(createOrgInviteSchema.parse({ email: 'A@B.CO', roleName: 'contributor' })).toEqual({
        email: 'a@b.co',
        roleName: 'contributor',
      });
      expect(() => createOrgInviteSchema.parse({ email: 'a@b.co' })).toThrow();
      expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'admin' })).toThrow();
      expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'viewer', notes: 'x'.repeat(501) })).toThrow();
    });

    it('takes no org id from the body', () => {
      expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'viewer', orgId: 'org-b' })).toThrow();
    });
  });
});
