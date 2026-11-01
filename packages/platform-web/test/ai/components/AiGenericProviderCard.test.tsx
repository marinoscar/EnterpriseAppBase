/**
 * The generic AI provider card and the card registry (PP-14.6, issue #924).
 * The card is controlled: it reports the next `AiProviderFormValue` and calls
 * the key actions; the page (tested in `pages/AiConfigPage.custom-provider`)
 * owns the state and the saves.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { render } from '../harness.js';
import { AiGenericProviderCard } from '../../../src/ai/ui/admin/AiGenericProviderCard.js';
import { AiProviderCard } from '../../../src/ai/ui/admin/AiProviderCard.js';
import type { AiProviderCardProps } from '../../../src/ai/ui/admin/AiProviderCard.js';
import { toProviderFormValue, toProviderInput } from '../../../src/ai/ui/admin/aiProviderForm.js';
import type { AiProviderFormValue } from '../../../src/ai/ui/admin/aiProviderForm.js';
import {
  getAiProviderCard,
  registerAiProviderCard,
  resetAiProviderCardsForTests,
} from '../../../src/ai/ui/admin/aiProviderCardRegistry.js';
import { registerBuiltinAiProviderCards } from '../../../src/ai/ui/admin/builtinAiProviderCards.js';
import { mockAiAdminConfigWithExample } from '../fixtures.js';
import type { AiAdminProvider } from '../../../src/ai/headless/types.js';

const example = mockAiAdminConfigWithExample.providers[1] as AiAdminProvider;
const descriptor = mockAiAdminConfigWithExample.descriptors![1]!;

/** The card with its form value held, as the page holds it; every key action is a spy. */
function Harness({ provider = example, canWrite = true, spies }: { provider?: AiAdminProvider; canWrite?: boolean; spies: Spies }): ReactElement {
  const [value, setValue] = useState<AiProviderFormValue>(toProviderFormValue(provider));
  spies.latest = value;
  const props: AiProviderCardProps = {
    provider,
    descriptor,
    value,
    onChange: setValue,
    canWrite,
    aiEnabled: true,
    keyAction: null,
    busy: false,
    keyError: null,
    onClearKeyError: vi.fn(),
    onSaveKey: spies.onSaveKey,
    onRemoveKey: spies.onRemoveKey,
    isProbing: false,
    probeError: null,
    onClearProbeError: vi.fn(),
    testResult: null,
    onClearTestResult: vi.fn(),
    onTest: spies.onTest,
  };
  return <AiGenericProviderCard {...props} />;
}

interface Spies {
  latest: AiProviderFormValue | undefined;
  onSaveKey: Mock<(apiKey: string) => Promise<boolean>>;
  onRemoveKey: Mock<() => Promise<boolean>>;
  onTest: Mock<(apiKey: string) => void>;
}

function spies(): Spies {
  return {
    latest: undefined,
    onSaveKey: vi.fn<(apiKey: string) => Promise<boolean>>().mockResolvedValue(true),
    onRemoveKey: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    onTest: vi.fn<(apiKey: string) => void>(),
  };
}

describe('AiGenericProviderCard', () => {
  it('reports { enabled: true, region: "eu" } as the PUT entry and a typed key through onSaveKey', async () => {
    const user = userEvent.setup();
    const s = spies();
    render(<Harness spies={s} />);

    await user.click(screen.getByRole('switch', { name: 'Enable Example Transcribe' }));
    await user.click(screen.getByRole('combobox', { name: 'Region' }));
    await user.click(screen.getByRole('option', { name: 'eu' }));
    expect(toProviderInput(example, s.latest!)).toEqual({ enabled: true, region: 'eu' });

    await user.type(screen.getByLabelText(/Example Transcribe API key/), 'asm-typed-key-1234');
    await user.click(screen.getByRole('button', { name: /save key/i }));
    await waitFor(() => expect(s.onSaveKey).toHaveBeenCalledWith('asm-typed-key-1234'));
    await waitFor(() => expect(screen.getByLabelText(/Example Transcribe API key/)).toHaveValue(''));
  });

  it('keeps the typed key out of the form value', async () => {
    const user = userEvent.setup();
    const s = spies();
    render(<Harness spies={s} />);

    await user.type(screen.getByLabelText(/Example Transcribe API key/), 'asm-typed-key-1234');
    expect(JSON.stringify(s.latest)).not.toContain('asm-typed-key-1234');
  });

  it('tests with the typed key (none stored, so a key is needed first)', async () => {
    const user = userEvent.setup();
    const s = spies();
    render(<Harness spies={s} />);

    expect(screen.getByRole('button', { name: /^test$/i })).toBeDisabled();
    expect(screen.getByText('Type a key to test it — none is stored yet.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Example Transcribe API key/), 'asm-typed-key-1234');
    await user.click(screen.getByRole('button', { name: /^test$/i }));
    expect(s.onTest).toHaveBeenCalledWith('asm-typed-key-1234');
  });

  it('disables every control for a viewer without the write permission', () => {
    render(<Harness spies={spies()} canWrite={false} />);

    expect(screen.getByRole('switch', { name: 'Enable Example Transcribe' })).toBeDisabled();
    expect(screen.getByLabelText(/Example Transcribe API key/)).toBeDisabled();
    expect(screen.getByRole('button', { name: /save key/i })).toBeDisabled();
  });

  it('shows the provider\'s own endpoint help (help.baseUrl) under a baseUrl field, and edits it as the form\'s baseUrl', async () => {
    const user = userEvent.setup();
    const gateway: AiAdminProvider = {
      ...example,
      settingsFields: ['baseUrl'],
      settings: {},
      requiresBaseUrl: true,
      help: { baseUrl: 'The gateway root, including /v1.' },
    };
    const gatewayDescriptor = {
      ...descriptor,
      fields: [
        { kind: 'boolean' as const, name: 'enabled', label: 'Enabled' },
        { kind: 'string' as const, name: 'baseUrl', label: 'Base url', help: 'generic help' },
        ...descriptor.fields.filter((field) => field.kind === 'secret'),
      ],
    };
    const onChange = vi.fn();
    render(
      <AiGenericProviderCard
        provider={gateway}
        descriptor={gatewayDescriptor}
        value={toProviderFormValue(gateway)}
        onChange={onChange}
        canWrite
        aiEnabled
        keyAction={null}
        busy={false}
        keyError={null}
        onClearKeyError={vi.fn()}
        onSaveKey={vi.fn()}
        onRemoveKey={vi.fn()}
        isProbing={false}
        probeError={null}
        onClearProbeError={vi.fn()}
        testResult={null}
        onClearTestResult={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByText('The gateway root, including /v1.')).toBeInTheDocument();
    expect(screen.queryByText('generic help')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Base url'), 'h');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: 'h' }));
  });

  it('says so when the provider uses no key', () => {
    const keyless = { ...descriptor, fields: descriptor.fields.filter((field) => field.kind !== 'secret') };
    const s = spies();
    function Keyless(): ReactElement {
      return (
        <AiGenericProviderCard
          provider={example}
          descriptor={keyless}
          value={toProviderFormValue(example)}
          onChange={vi.fn()}
          canWrite
          aiEnabled
          keyAction={null}
          busy={false}
          keyError={null}
          onClearKeyError={vi.fn()}
          onSaveKey={s.onSaveKey}
          onRemoveKey={s.onRemoveKey}
          isProbing={false}
          probeError={null}
          onClearProbeError={vi.fn()}
          testResult={null}
          onClearTestResult={vi.fn()}
          onTest={s.onTest}
        />
      );
    }
    render(<Keyless />);
    expect(screen.getByText(/does not use one/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument();
  });
});

describe('the AI provider card registry', () => {
  afterEach(() => {
    resetAiProviderCardsForTests();
  });

  it('the five built-ins register their existing bespoke card, and nothing else has one', () => {
    registerBuiltinAiProviderCards();
    for (const id of ['openai', 'anthropic', 'gemini', 'azure-openai', 'openai-compatible']) {
      expect(getAiProviderCard(id)).toBe(AiProviderCard);
    }
    expect(getAiProviderCard('example-transcribe')).toBeUndefined();
  });

  it('an app registration replaces a built-in and survives the built-ins registering later', () => {
    const Mine = () => null;
    registerAiProviderCard('openai', Mine);
    registerBuiltinAiProviderCards();
    expect(getAiProviderCard('openai')).toBe(Mine);
    expect(getAiProviderCard('gemini')).toBe(AiProviderCard);
  });

  it('registering an id again replaces it (a hot reload re-runs the module)', () => {
    const First = () => null;
    const Second = () => null;
    registerAiProviderCard('example-transcribe', First);
    registerAiProviderCard('example-transcribe', Second);
    expect(getAiProviderCard('example-transcribe')).toBe(Second);
  });
});
