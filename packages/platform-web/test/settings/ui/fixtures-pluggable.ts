// A hand-written descriptor for the pluggable-form suites: every field kind,
// in the order `describe` serves them (settings in declaration order, then the
// declared secrets).
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';

export const KITCHEN_SINK: PluggableDescriptor = {
  kind: 'demo',
  id: 'kitchen-sink',
  label: 'Kitchen sink',
  description: 'Every field kind.',
  fields: [
    { kind: 'string', name: 'greeting', label: 'Greeting', help: 'The word said before the name', maxLength: 40 },
    { kind: 'boolean', name: 'shout', label: 'Shout', help: 'Upper-case the whole greeting' },
    { kind: 'number', name: 'repeat', label: 'Repeat', min: 1, max: 3, integer: true },
    { kind: 'enum', name: 'style', label: 'Style', options: ['formal', 'casual'] },
    { kind: 'other', name: 'headers', label: 'Headers' },
    { kind: 'secret', name: 'apiKey', label: 'Signing key', help: 'Stored encrypted.', hasValue: false, required: true },
  ],
};

export const STORED = { greeting: 'Hello', shout: false, repeat: 2, style: 'formal', headers: { a: '1' } };
