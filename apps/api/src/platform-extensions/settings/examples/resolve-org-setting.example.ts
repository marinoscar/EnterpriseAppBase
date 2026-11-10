// =============================================================================
// Reference example: reading a setting through SettingsResolver (#733)
// =============================================================================
//
// A slice that acts inside an organization reads its policy through
// `SettingsResolver.resolveSystem(key, { orgId })`: the deployment value, with
// that organization's overrides applied as the namespace's `org.merge`
// declares. A per-user preference is `resolveUser(key, userId)`. Neither read
// creates a row. `SettingsModule.forRoot()` is global, so injecting the
// resolver needs no module import.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { SettingsResolver } from '@marinoscar/platform-api/settings';
import type { DataTablesValue } from '@marinoscar/platform-contract/settings';

import type { ExportPolicyValue } from './org-overridable.namespaces';

@Injectable()
export class ExportPolicyReader {
  constructor(private readonly settings: SettingsResolver) {}

  /** Whether `orgId` may export, and the most rows one export may hold there. */
  forOrg(orgId: string): Promise<ExportPolicyValue> {
    return this.settings.resolveSystem<ExportPolicyValue>('exportPolicy', { orgId });
  }

  /** The user's saved view of one table, or `undefined` for the built-in defaults. */
  async tableView(userId: string, tableId: string) {
    const tables = await this.settings.resolveUser<DataTablesValue>('dataTables', userId);
    return tables?.[tableId];
  }
}
