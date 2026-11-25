// =============================================================================
// Worked example: the Doctor check kit over the app's own check (PP-14.26)
// =============================================================================
//
// `ExampleCapabilityDoctorCheck` (`src/examples/doctor/`) is the app-owned check
// of the Doctor recipe. This spec is what an extension author writes beside their
// own: `describeDoctorCheckConformance` builds the check once per test over a
// recording Prisma client and a write-failing storage provider, runs it under the
// service's guard and grades the result against the five rules of the contract:
// identity, completes and never throws, a valid outcome with a remedy on warn and
// fail, READ-ONLY, no secret material.
//
// A scenario is one world to run the check in. Here the check reads its facts
// through a closure; a check that reads settings or rows scripts them instead,
// with `prisma: { results: { 'setting.findFirst': {...} } }`, and the recording
// client proves it only ever read.
//
// The suite that runs the same proof over EVERY registered check of the booted
// app is `doctor-read-only` in `test/conformance.spec.ts`.
// =============================================================================

import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';
import { describeDoctorCheckConformance } from '@marinoscar/platform-api/doctor/testing';
import type { DoctorCheckFactory } from '@marinoscar/platform-api/doctor/testing';

import { ExampleCapabilityDoctorCheck } from '../../../src/examples/doctor/example-capability.doctor-check';
import type { ExampleCapabilityFacts } from '../../../src/examples/doctor/example-capability.doctor-check';

/** The check over the doubles, reading `facts` after one (read-only) look at a setting row. */
const checkReading =
  (facts: ExampleCapabilityFacts): DoctorCheckFactory =>
  ({ prisma }) =>
    new ExampleCapabilityDoctorCheck(new DoctorCheckRegistry(), async () => {
      await prisma.client.systemSettings.findFirst();
      return facts;
    });

describeDoctorCheckConformance('example.capability', checkReading({ configured: true, enabled: true }), {
  scenarios: [
    { name: 'enabled and configured', expectStatus: 'pass' },
    { name: 'enabled but not configured', build: checkReading({ configured: false, enabled: true }), expectStatus: 'fail' },
    { name: 'switched off (intentional)', build: checkReading({ configured: false, enabled: false }), expectStatus: 'skip' },
  ],
});
