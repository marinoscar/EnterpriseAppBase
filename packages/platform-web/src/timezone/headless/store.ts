// The display-zone store lives in `core` (src/core/time-zone/store.ts) so every
// slice, identity included, can render in the user's zone without a cycle in
// the slice graph (timezone depends on identity). This file keeps the slice's
// own imports and its `/timezone/headless` entry pointing at the one instance.

export {
  TIME_ZONE_STORAGE_KEY,
  deviceTimeZone,
  getDisplayTimeZone,
  getPreferredTimeZone,
  setPreferredTimeZone,
  subscribeDisplayTimeZone,
  timeZoneFromProfile,
  useDisplayTimeZone,
  usePreferredTimeZone,
} from '../../core/index.js';
