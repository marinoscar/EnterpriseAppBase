---
"@marinoscar/platform-db": minor
---

Jobs carry their organization (#734): `Job.orgId` (`jobs.org_id`, nullable, FK `organizations(id)` `ON DELETE SET NULL`; NULL is a deployment-wide system job) and `Organization.jobs` in the `jobs` fragment. Migration `0031_add_jobs_org_id` adds the column (metadata-only) and the foreign key (`NOT VALID`, then `VALIDATE`); `0032_add_jobs_org_id_status_index` builds `jobs_org_id_status_idx` `(org_id, status)` `CONCURRENTLY`, alone in its migration. No row-level security on `jobs`, and `jobs_active_dedup_uniq_idx` is unchanged.
