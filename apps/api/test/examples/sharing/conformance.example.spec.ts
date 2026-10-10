// =============================================================================
// Mocked: the sharing conformance suite over the examples themselves (#732)
// =============================================================================
//
// The reference app's own run is test/sharing/sharing-conformance.spec.ts,
// where nothing is registered yet. Here the suite checks code that uses every
// seam: the example files (scanned for direct table access), a root module
// mounting the slice and the guarded public album route, the two example
// resource types in the snapshot, and the reference app's migrations. This is
// what an adopting app's run looks like once it registers types.
// =============================================================================

import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '@marinoscar/platform-api/identity';
import { SharingModule } from '@marinoscar/platform-api/sharing';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/sharing/testing';

import { platformHost } from '../../../src/platform/platform-host';
import { ALBUM_TYPE, registerAlbumResourceType } from './group-owned-resource.example';
import { registerGroupNotes } from './group-owned-count.example';
import { PublicAlbumController } from './public-album.controller.example';
import { NOTE_TYPE, registerNoteResourceType } from './user-owned-resource.example';

registerNoteResourceType();
registerAlbumResourceType();
registerGroupNotes();

@Module({
  imports: [SharingModule.forRoot({ host: platformHost })],
  controllers: [PublicAlbumController],
})
class ExamplesRootModule {}

const API_ROOT = join(__dirname, '..', '..', '..');

runPlatformConformance({
  sourceRoots: [__dirname],
  suites: {
    sharing: {
      schemaPath: join(API_ROOT, 'prisma', 'schema'),
      migrationsDir: join(API_ROOT, 'prisma', 'migrations'),
      rootModule: ExamplesRootModule,
      isPublic: (target) => Reflect.getMetadata(IS_PUBLIC_KEY, target) === true,
      // The example tables are raw SQL with no Prisma model, so no model maps here;
      // an app with `model Album { ownerGroupId String? @map("owner_group_id") }` writes { Album: 'album' }.
      groupOwnedModels: {},
      resourceTypeIds: [NOTE_TYPE, ALBUM_TYPE],
    },
  },
});
