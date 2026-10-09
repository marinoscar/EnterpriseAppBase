// Every optional slice the starter can mount, as data. Importing this file
// runs nothing (each definition is an object of lazy loaders), so adding a
// slice here costs a disabled app nothing. Which of them mount is
// `packages/shared/slices.json`; `./manifest.ts` validates and resolves it.
//
// To remove a slice's code from the app for good: delete its `src/platform/<id>/`
// folder, its line below and its id from `SLICE_IDS` (`./slice.ts`), and the
// web side's `src/slices/<id>.tsx`. To only switch it off, remove its id from
// `slices.json` and nothing else.
import { credentialsSlice } from '../credentials/credentials.slice';
import { storageSlice } from '../storage/storage.slice';
import type { ApiSlice, SliceId } from './slice';

// (Partial while the slices are added one commit at a time.)
export const ALL_SLICES = {
  credentials: credentialsSlice,
  storage: storageSlice,
} as unknown as Readonly<Record<SliceId, ApiSlice>>;
