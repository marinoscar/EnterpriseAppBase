/**
 * `PluggableConfigForm` and `usePluggableConfigForm` (#923, PP-14.5): the
 * generated form of a pluggable implementation. Each field kind, the
 * write-only secret (never rendered back, presence shown), the payload that
 * leaves an untouched secret out, dirty/reset and disabled.
 */
import { describe, expect, it } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';

import { render, renderHook } from './test-utils.js';
import { KITCHEN_SINK, STORED } from './fixtures-pluggable.js';
import { PluggableConfigForm } from '../../../src/settings/ui/index.js';
import type { PluggableConfigFormProps } from '../../../src/settings/ui/index.js';
import { usePluggableConfigForm } from '../../../src/settings/headless/index.js';
import type { UsePluggableConfigFormResult } from '../../../src/settings/headless/index.js';

/** The form wired to the hook, exposing the hook result to the test. */
function Harness({
  descriptor = KITCHEN_SINK,
  initial = STORED,
  expose,
  ...rest
}: {
  descriptor?: PluggableDescriptor;
  initial?: Record<string, unknown>;
  expose?: (form: UsePluggableConfigFormResult) => void;
} & Partial<Pick<PluggableConfigFormProps, 'disabled' | 'slots'>>) {
  const form = usePluggableConfigForm(descriptor, initial);
  expose?.(form);
  return (
    <PluggableConfigForm
      descriptor={descriptor}
      value={form.value}
      onChange={form.setField}
      secrets={form.secrets}
      onSecretChange={form.setSecret}
      {...rest}
    />
  );
}

describe('PluggableConfigForm', () => {
  it('renders each field kind with its label, help and current value', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Kitchen sink' });
    expect(within(group).getByLabelText('Greeting')).toHaveValue('Hello');
    expect(screen.getByText('The word said before the name')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Shout' })).not.toBeChecked();
    expect(screen.getByText('Upper-case the whole greeting')).toBeInTheDocument();
    expect(screen.getByLabelText('Repeat')).toHaveValue(2);
    expect(screen.getByLabelText('Repeat')).toHaveAttribute('min', '1');
    expect(screen.getByLabelText('Repeat')).toHaveAttribute('max', '3');
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('formal');
    expect(screen.getByText('Headers: managed elsewhere.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Signing key/)).toHaveAttribute('type', 'password');
  });

  it('reports a change of every editable kind through onChange(name, value)', async () => {
    const user = userEvent.setup();
    let latest!: UsePluggableConfigFormResult;
    render(<Harness expose={(form) => (latest = form)} />);

    await user.clear(screen.getByLabelText('Greeting'));
    await user.type(screen.getByLabelText('Greeting'), 'Hi');
    await user.click(screen.getByRole('switch', { name: 'Shout' }));
    await user.clear(screen.getByLabelText('Repeat'));
    await user.type(screen.getByLabelText('Repeat'), '3');
    await user.click(screen.getByRole('combobox', { name: 'Style' }));
    await user.click(screen.getByRole('option', { name: 'casual' }));

    expect(latest.value).toMatchObject({ greeting: 'Hi', shout: true, repeat: 3, style: 'casual' });
    expect(screen.getByLabelText('Greeting')).toHaveValue('Hi');
  });

  it('clears an emptied number or string field to undefined', async () => {
    const user = userEvent.setup();
    let latest!: UsePluggableConfigFormResult;
    render(<Harness expose={(form) => (latest = form)} />);
    await user.clear(screen.getByLabelText('Repeat'));
    await user.clear(screen.getByLabelText('Greeting'));
    expect('repeat' in latest.value).toBe(false);
    expect('greeting' in latest.value).toBe(false);
  });

  it('shows a stored secret as saved and never renders a value', () => {
    const stored: PluggableDescriptor = {
      ...KITCHEN_SINK,
      fields: KITCHEN_SINK.fields.map((f) => (f.kind === 'secret' ? { ...f, hasValue: true } : f)),
    };
    render(<Harness descriptor={stored} />);
    const input = screen.getByLabelText(/Signing key/);
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).not.toBeRequired();
    expect(screen.getByText(/A signing key is saved/)).toBeInTheDocument();
    expect(screen.getByText(/Leave this blank to keep it/)).toBeInTheDocument();
  });

  it('marks a required, unset secret as required and shows its help', () => {
    render(<Harness />);
    expect(screen.getByLabelText(/Signing key/)).toBeRequired();
    expect(screen.getByText('Stored encrypted.')).toBeInTheDocument();
  });

  it('echoes only what the user typed into a secret, as a password', async () => {
    const user = userEvent.setup();
    let latest!: UsePluggableConfigFormResult;
    render(<Harness expose={(form) => (latest = form)} />);
    await user.type(screen.getByLabelText(/Signing key/), 'sk-typed');
    expect(latest.secrets).toEqual({ apiKey: 'sk-typed' });
    expect(screen.getByLabelText(/Signing key/)).toHaveAttribute('type', 'password');
  });

  it('disables every control when disabled', () => {
    render(<Harness disabled />);
    expect(screen.getByLabelText('Greeting')).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Shout' })).toBeDisabled();
    expect(screen.getByLabelText('Repeat')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText(/Signing key/)).toBeDisabled();
  });

  it('lets a slot replace one field and the note of an other field', () => {
    render(
      <Harness
        slots={{
          renderField: ({ field, defaultControl }) =>
            field.name === 'greeting' ? <p>custom greeting control</p> : field.name === 'repeat' ? undefined : defaultControl,
          otherNote: (field) => `${field.name} is edited on its own page`,
        }}
      />,
    );
    expect(screen.getByText('custom greeting control')).toBeInTheDocument();
    expect(screen.queryByLabelText('Greeting')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Repeat')).toBeInTheDocument();
    expect(screen.getByText('headers is edited on its own page')).toBeInTheDocument();
  });
});

describe('usePluggableConfigForm', () => {
  it('starts clean with blank secrets', () => {
    const { result } = renderHook(() => usePluggableConfigForm(KITCHEN_SINK, STORED));
    expect(result.current.dirty).toBe(false);
    expect(result.current.value).toEqual(STORED);
    expect(result.current.secrets).toEqual({});
  });

  it('is dirty after a setting changes and clean again when it returns', () => {
    const { result } = renderHook(() => usePluggableConfigForm(KITCHEN_SINK, STORED));
    act(() => result.current.setField('shout', true));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setField('shout', false));
    expect(result.current.dirty).toBe(false);
  });

  it('is dirty once a secret is typed, not for a blank one', () => {
    const { result } = renderHook(() => usePluggableConfigForm(KITCHEN_SINK, STORED));
    act(() => result.current.setSecret('apiKey', ''));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setSecret('apiKey', 'k'));
    expect(result.current.dirty).toBe(true);
  });

  it('payload omits an untouched secret and keeps the settings', () => {
    const { result } = renderHook(() => usePluggableConfigForm(KITCHEN_SINK, STORED));
    expect(result.current.payload()).toEqual({ settings: STORED, secrets: {} });
    act(() => result.current.setSecret('apiKey', ''));
    expect(result.current.payload().secrets).toEqual({});
  });

  it('payload includes a changed secret byte for byte', () => {
    const { result } = renderHook(() => usePluggableConfigForm(KITCHEN_SINK, STORED));
    act(() => result.current.setSecret('apiKey', ' sk-1 '));
    act(() => result.current.setField('greeting', 'Hi'));
    expect(result.current.payload()).toEqual({
      settings: { ...STORED, greeting: 'Hi' },
      secrets: { apiKey: ' sk-1 ' },
    });
  });

  it('payload leaves out settings that are not descriptor fields and cleared ones', () => {
    const { result } = renderHook(() => usePluggableConfigForm(KITCHEN_SINK, { ...STORED, stray: 1 }));
    act(() => result.current.setField('repeat', undefined));
    const { settings } = result.current.payload();
    expect('stray' in settings).toBe(false);
    expect('repeat' in settings).toBe(false);
  });

  it('reset returns to the initial settings and clears typed secrets', () => {
    const { result } = renderHook(() => usePluggableConfigForm(KITCHEN_SINK, STORED));
    act(() => {
      result.current.setField('greeting', 'Changed');
      result.current.setSecret('apiKey', 'typed');
    });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.value).toEqual(STORED);
    expect(result.current.secrets).toEqual({});
    expect(result.current.dirty).toBe(false);
  });

  it('reset adopts the newest initial settings (after a save)', () => {
    let initial: Record<string, unknown> = STORED;
    const { result, rerender } = renderHook(() => usePluggableConfigForm(KITCHEN_SINK, initial));
    act(() => result.current.setField('greeting', 'Saved'));
    initial = { ...STORED, greeting: 'Saved' };
    rerender();
    expect(result.current.dirty).toBe(false);
    act(() => result.current.reset());
    expect(result.current.value.greeting).toBe('Saved');
  });
});
