import { afterEach, describe, expect, it } from 'vitest';

import {
  getEmailTransportPanel,
  getEmailTransportPanelOptions,
  registerBuiltinEmailTransportPanel,
  registerEmailTransportPanel,
  resetEmailTransportPanelsForTests,
} from '../../src/email/ui/emailTransportPanelRegistry.js';
import { registerBuiltinEmailTransportPanels } from '../../src/email/ui/builtinEmailTransportPanels.js';
import { SesTransportPanel } from '../../src/email/ui/SesTransportPanel.js';
import { SmtpTransportPanel } from '../../src/email/ui/SmtpTransportPanel.js';

const Mine = () => null;
const Theirs = () => null;

describe('the email transport panel registry', () => {
  afterEach(() => resetEmailTransportPanelsForTests());

  it('registers the two built-in panels through the same registry an app uses', () => {
    registerBuiltinEmailTransportPanels();

    expect(getEmailTransportPanel('ses')).toBe(SesTransportPanel);
    expect(getEmailTransportPanel('smtp')).toBe(SmtpTransportPanel);
    expect(getEmailTransportPanelOptions('smtp').toInput).toBeTypeOf('function');
    expect(getEmailTransportPanelOptions('ses').validate).toBeTypeOf('function');
  });

  it('knows no panel for an unregistered transport (the page then generates the form)', () => {
    expect(getEmailTransportPanel('sendgrid')).toBeUndefined();
    expect(getEmailTransportPanelOptions('sendgrid')).toEqual({});
  });

  it('an app registration wins over a built-in, whichever registers first', () => {
    registerBuiltinEmailTransportPanel('mail-x', Theirs);
    registerEmailTransportPanel('mail-x', Mine);
    expect(getEmailTransportPanel('mail-x')).toBe(Mine);

    resetEmailTransportPanelsForTests();
    registerEmailTransportPanel('mail-y', Mine);
    registerBuiltinEmailTransportPanel('mail-y', Theirs);
    expect(getEmailTransportPanel('mail-y')).toBe(Mine);
  });

  it('registering again replaces the earlier registration (a hot reload re-runs the module)', () => {
    registerEmailTransportPanel('mail-z', Theirs);
    registerEmailTransportPanel('mail-z', Mine, { validate: () => ({}) });

    expect(getEmailTransportPanel('mail-z')).toBe(Mine);
    expect(getEmailTransportPanelOptions('mail-z').validate).toBeTypeOf('function');
  });

  it('forgets app registrations on reset but keeps the built-ins', () => {
    registerBuiltinEmailTransportPanel('keep-me', Theirs);
    registerEmailTransportPanel('drop-me', Mine);

    resetEmailTransportPanelsForTests();

    expect(getEmailTransportPanel('keep-me')).toBe(Theirs);
    expect(getEmailTransportPanel('drop-me')).toBeUndefined();
  });
});
