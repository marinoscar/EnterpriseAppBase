import { createOrganizationSchema, renameOrganizationSchema } from '../../../../src/identity/organizations/dto/organization.dto';
import { updateOrgMemberSchema } from '../../../../src/identity/organizations/dto/org-member.dto';
import { createOrgInviteSchema } from '../../../../src/identity/organizations/dto/org-invite.dto';

describe('org administration DTOs (#726)', () => {
  describe('createOrganizationSchema', () => {
    const valid = { name: '  Org Kappa ', slug: 'kappa', firstAdminEmail: 'Boss@KAPPA.EXAMPLE.TEST' };

    it('trims the name and lower-cases the first admin email', () => {
      expect(createOrganizationSchema.parse(valid)).toEqual({
        name: 'Org Kappa',
        slug: 'kappa',
        firstAdminEmail: 'boss@kappa.example.test',
      });
    });

    it.each(['a', '-kappa', 'kappa-', 'ac me', 'kappa_org', 'x'.repeat(64)])('rejects the slug %p', (slug) => {
      expect(() => createOrganizationSchema.parse({ ...valid, slug })).toThrow();
    });

    it.each(['ab', 'kappa', 'a1-b2', 'x'.repeat(63)])('accepts the slug %p', (slug) => {
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
      // The schema checks the SHAPE of a role id; the service refuses `admin` (ROLE_NOT_ASSIGNABLE).
      expect(() => updateOrgMemberSchema.parse({ roleName: 'Not A Role' })).toThrow();
      expect(updateOrgMemberSchema.parse({ roleName: 'coach' })).toEqual({ roleName: 'coach' });
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
      expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'Not A Role' })).toThrow();
      expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'viewer', notes: 'x'.repeat(501) })).toThrow();
    });

    it('takes no org id from the body', () => {
      expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'viewer', orgId: 'org-b' })).toThrow();
    });
  });
});
