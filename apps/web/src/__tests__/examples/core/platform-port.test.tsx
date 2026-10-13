/**
 * PP-14.14: an extension package reads a port the app supplies in
 * `host.extensions`, with no package edit.
 *
 * `apps/web/src/platform-extensions/core/transcripts-port.example.tsx` is the
 * example. The test mounts the REAL `PlatformHostProvider` of
 * `@marinoscar/platform-web/core` with a host that supplies the port, and with
 * one that does not.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';

import {
  OpenTranscriptButton,
  TRANSCRIPTS_PORT,
  type TranscriptsPort,
} from '../../../platform-extensions/core/transcripts-port.example';

describe('a package port supplied through host.extensions', () => {
  it('reaches the package component, which calls the app\'s implementation', async () => {
    const port: TranscriptsPort = { open: vi.fn() };
    const host = createTestPlatformHost({ extensions: { [TRANSCRIPTS_PORT]: port } });

    render(
      <PlatformHostProvider host={host}>
        <OpenTranscriptButton id="t-42" />
      </PlatformHostProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open transcript' }));

    expect(port.open).toHaveBeenCalledWith('t-42');
  });

  it('fails at the first render with the key and the fix when the app did not supply it', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = createTestPlatformHost();

    expect(() =>
      render(
        <PlatformHostProvider host={host}>
          <OpenTranscriptButton id="t-42" />
        </PlatformHostProvider>,
      ),
    ).toThrow(/no extension port Symbol\(@acme\/transcripts\/port\).*host\.extensions/);

    consoleError.mockRestore();
  });
});
