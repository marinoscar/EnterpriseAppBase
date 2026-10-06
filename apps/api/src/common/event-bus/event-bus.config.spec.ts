import { parseEventBusAdapter } from './event-bus.config';

describe('parseEventBusAdapter (PP-1.11, #682)', () => {
  it.each([undefined, null, '', '   ', 42])('treats %p as the in-process default, recognised', (raw) => {
    expect(parseEventBusAdapter(raw)).toMatchObject({ adapter: 'in-process', recognised: true });
  });

  it.each([
    ['postgres', 'postgres'],
    ['in-process', 'in-process'],
    [' Postgres ', 'postgres'],
    ['IN-PROCESS', 'in-process'],
  ])('recognises %p', (raw, adapter) => {
    expect(parseEventBusAdapter(raw)).toEqual({ adapter, recognised: true, configured: raw.trim() });
  });

  it.each(['redis', 'pg', 'postgresql', 'in_process'])(
    'fails safe to in-process for an unrecognised %p, and says so',
    (raw) => {
      expect(parseEventBusAdapter(raw)).toEqual({ adapter: 'in-process', recognised: false, configured: raw });
    },
  );
});
