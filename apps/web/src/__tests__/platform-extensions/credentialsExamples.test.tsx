import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WebhookSigningKeyField } from '../../platform-extensions/credentials/examples/WebhookSigningKeyField';

// The credentials slice's web example (#735): the app renders `SecretField`
// from the package and submits with `secretForSubmit`.
describe('WebhookSigningKeyField (credentials example)', () => {
  it('shows the saved hint and keeps the stored secret when saved blank', () => {
    const onSave = vi.fn();
    render(
      <WebhookSigningKeyField
        saved={{ purpose: 'webhook_signing_key', name: 'default', hint: '••••wxyz', label: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText('Webhook signing secret')).toHaveAccessibleDescription(/A signing secret is saved \(••••wxyz\), updated .+\. Leave this blank to keep it/);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  it('says nothing is saved, and sends a typed replacement', () => {
    const onSave = vi.fn();
    render(<WebhookSigningKeyField saved={null} onSave={onSave} />);
    const input = screen.getByLabelText('Webhook signing secret');
    expect(input).toHaveAccessibleDescription('No signing secret is saved yet. Webhooks are sent unsigned until you add one.');
    fireEvent.change(input, { target: { value: 'whsec_123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('whsec_123');
  });
});
