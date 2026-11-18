// SecretField (#735): saved and unsaved states, blank-keeps semantics, the
// helper text linked by aria-describedby, and no reveal toggle.
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { secretForSubmit } from '../../src/credentials/headless/index.js';
import { SecretField } from '../../src/credentials/ui/index.js';

const fixedDate = (d: Date) => d.toISOString().slice(0, 10);

describe('SecretField', () => {
  it('is a password input whose helper text, linked by aria-describedby, says a secret is saved', () => {
    render(
      <SecretField label="API key" value="" onChange={() => undefined} saved={{ hint: '••••abcd', updatedAt: '2026-10-08T00:00:00Z' }} formatDate={fixedDate} />,
    );
    const input = screen.getByLabelText('API key');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveAccessibleDescription(
      'A key is saved (••••abcd), updated 2026-10-08. Leave this blank to keep it, or type a new one to replace it.',
    );
  });

  it('says nothing is saved, in its own words, when there is no secret', () => {
    render(<SecretField label="Password" value="" onChange={() => undefined} saved={null} emptyHelp="No password is saved yet." />);
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('No password is saved yet.');
  });

  it('reports every keystroke, and a blank field submits nothing (blank keeps the stored secret)', () => {
    const submitted = vi.fn();
    function Form() {
      const [value, setValue] = useState('');
      return (
        <form onSubmit={(e) => { e.preventDefault(); submitted(secretForSubmit(value)); }}>
          <SecretField label="Secret" value={value} onChange={setValue} saved={{ hint: '••••1234' }} />
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByText('Save'));
    expect(submitted).toHaveBeenLastCalledWith(undefined);
    fireEvent.change(screen.getByLabelText('Secret'), { target: { value: 'replacement' } });
    fireEvent.click(screen.getByText('Save'));
    expect(submitted).toHaveBeenLastCalledWith('replacement');
  });

  it('has no reveal toggle, and shows an error instead of the helper text', () => {
    render(<SecretField label="Secret" value="x" onChange={() => undefined} error="Too short" />);
    expect(screen.queryByRole('button')).toBeNull();
    const input = screen.getByLabelText('Secret');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Too short');
  });

  it('passes slots.textField props through, but keeps its own type', () => {
    render(
      <SecretField
        label="Secret"
        value=""
        onChange={() => undefined}
        disabled
        slots={{ textField: { placeholder: 'unchanged', type: 'text' } as never }}
      />,
    );
    const input = screen.getByLabelText('Secret');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'unchanged');
    expect(input).toHaveAttribute('type', 'password');
  });
});
