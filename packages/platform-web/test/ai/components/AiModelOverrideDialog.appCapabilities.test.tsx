/**
 * The model override dialog offers the capabilities an app registered
 * (`GET /admin/ai/capabilities`) after the built-in groups — PP-14.17 (#935).
 * Without them a model's app capability would be dropped on save.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { render } from '../harness.js';
import { AiModelOverrideDialog } from '../../../src/ai/ui/admin/AiModelOverrideDialog.js';
import type { AiCapabilityDescriptor, AiModel } from '../../../src/ai/headless/types.js';
import { mockAiModels } from '../fixtures.js';

const DIARIZATION: AiCapabilityDescriptor = {
  id: 'speaker_diarization',
  label: 'Diarization',
  description: 'Labels who spoke when.',
  builtin: false,
};

const model: AiModel = {
  ...mockAiModels[0],
  capabilities: { capabilities: ['audio_transcription', 'speaker_diarization'], inputModalities: ['audio'], outputModalities: ['text'] },
};

function renderDialog(appCapabilities: AiCapabilityDescriptor[] | undefined) {
  const onSave = vi.fn();

  render(
    <AiModelOverrideDialog
      model={model}
      isSaving={false}
      error={null}
      appCapabilities={appCapabilities}
      onSave={onSave}
      onClose={() => undefined}
    />,
  );

  return onSave;
}

describe('AiModelOverrideDialog app capabilities', () => {
  it('offers an "Other capabilities" group with the app label, checked for a model that declares it', () => {
    renderDialog([DIARIZATION]);

    const group = screen.getByRole('group', { name: 'Other capabilities' });

    expect(group).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Diarization' })).toBeChecked();
  });

  it('keeps the app capability on save, and saves it unchecked when the admin unchecks it', async () => {
    const user = userEvent.setup();
    const onSave = renderDialog([DIARIZATION]);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0].capabilities).toEqual(['audio_transcription', 'speaker_diarization']);

    await user.click(screen.getByRole('checkbox', { name: 'Diarization' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[1][0].capabilities).toEqual(['audio_transcription']);
  });

  it('draws no extra group without app capabilities (the DOM is unchanged)', () => {
    renderDialog(undefined);

    expect(screen.queryByRole('group', { name: 'Other capabilities' })).not.toBeInTheDocument();
  });
});
