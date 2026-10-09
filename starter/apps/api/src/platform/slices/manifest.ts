// The resolved slice manifest: which optional slices this process mounts.
//
// `ENABLED_SLICES` (`packages/shared/slices.json`) is the only input. This file
// validates it against the definitions and exposes the questions the rest of
// the app asks (is X on? which slices' permissions are seeded?). It imports
// definitions, which are pure data, so importing it has no side effect: the
// seed, the permission registry and the composition all read it.
import { ENABLED_SLICES } from '@app/shared';
import type { PlatformPermissionSlice } from '@marinoscar/platform-api/manifest';

import { ALL_SLICES } from './definitions';
import { resolveSlices, type ApiSlice, type EnabledSlices, type SliceId } from './slice';

/** The enabled slices, validated and in mount order. */
export const ENABLED: readonly ApiSlice[] = resolveSlices(ENABLED_SLICES, ALL_SLICES);

/** The enabled slice ids, in mount order. */
export const ENABLED_IDS: readonly SliceId[] = Object.freeze(ENABLED.map((slice) => slice.id));

const IDS = new Set<SliceId>(ENABLED_IDS);

/** The enabled set, handed to a definition that adapts to its neighbours. */
export const enabledSlices: EnabledSlices = { has: (id) => IDS.has(id), ids: ENABLED_IDS };

/** Is this optional slice mounted? */
export function isSliceEnabled(id: SliceId): boolean {
  return IDS.has(id);
}

/** The permission-declaring platform slices the enabled slices bring (seeded by `prisma:seed`). */
export function enabledPermissionSlices(): readonly PlatformPermissionSlice[] {
  return [...new Set(ENABLED.flatMap((slice) => slice.permissionSlices ?? []))];
}
