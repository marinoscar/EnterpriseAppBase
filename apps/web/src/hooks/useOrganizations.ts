import { useCallback, useRef, useState } from 'react';
import {
  createOrganization,
  getOrganizations,
  renameOrganization,
  type Organization,
  type OrganizationListParams,
} from '../services/organizations';
import { useIsMounted } from './useIsMounted';

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export interface UseOrganizationsResult {
  organizations: Organization[];
  total: number;
  isLoading: boolean;
  error: string | null;
  fetchOrganizations: (params?: OrganizationListParams) => Promise<void>;
  /** Create an organization and its first-admin invitation, then re-read. Rethrows on failure. */
  createOrg: (data: { name: string; slug: string; firstAdminEmail: string }) => Promise<void>;
  /** Rename an organization, then re-read. Rethrows on failure. */
  renameOrg: (id: string, name: string) => Promise<void>;
}

/**
 * The deployment's organizations (#726), over `/api/admin/organizations`
 * (system `organizations:*`). The API refuses creation in single-org mode.
 */
export function useOrganizations(): UseOrganizationsResult {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [total, setTotal] = useState(0);
  // The last query, re-used by the refresh after a write. A ref, so the
  // fetch function stays stable for effects that depend on it.
  const paramsRef = useRef<OrganizationListParams>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const fetchOrganizations = useCallback(
    async (next?: OrganizationListParams) => {
      const effective = next ?? paramsRef.current;
      paramsRef.current = effective;
      setIsLoading(true);
      setError(null);
      try {
        const response = await getOrganizations(effective);
        if (isMounted()) {
          setOrganizations(response.items);
          setTotal(response.total);
        }
      } catch (err) {
        if (isMounted()) {
          setError(messageOf(err, 'Failed to load organizations'));
          setOrganizations([]);
        }
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    },
    [isMounted],
  );

  const createOrg = useCallback(
    async (data: { name: string; slug: string; firstAdminEmail: string }) => {
      setError(null);
      try {
        await createOrganization(data);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to create the organization'));
        throw err;
      }
      await fetchOrganizations();
    },
    [fetchOrganizations, isMounted],
  );

  const renameOrg = useCallback(
    async (id: string, name: string) => {
      setError(null);
      try {
        await renameOrganization(id, name);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to rename the organization'));
        throw err;
      }
      await fetchOrganizations();
    },
    [fetchOrganizations, isMounted],
  );

  return { organizations, total, isLoading, error, fetchOrganizations, createOrg, renameOrg };
}
